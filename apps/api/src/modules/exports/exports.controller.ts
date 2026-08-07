import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ExportQueryDto, ExportTypeParamDto } from './dto/export.dto';
import { ExportService, type ExportFormat } from './export.service';

/**
 * Tenant-scoped data exports (Phase 10). `GET /exports/:type?format=csv|xlsx|pdf`.
 * Requires `report:read` (held by all roles incl. Viewer). The service enforces
 * dataset-level scoping (e.g. companies = Super Admin only).
 */
@ApiTags('exports')
@ApiBearerAuth()
@Controller('exports')
export class ExportsController {
  constructor(
    private readonly exports: ExportService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Get(':type')
  @RequirePermissions(Permission.ReportRead)
  // An export is the single most expensive read in the API: it runs an
  // unpaginated (row-capped) query and renders the whole result set in memory.
  // Five per five minutes per identity is generous for a human clicking
  // "Export" and ruinous for a script looping over every dataset.
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ApiOperation({
    summary: 'Export a dataset as CSV/XLSX/PDF (?format, ?from, ?to, ?screenId, ?status).',
  })
  // A FILE, not JSON: the body is the rendered export and Content-Type is set
  // from ?format. There is no JSON schema to document, and pretending there is
  // one would have a generated client try to parse a PDF.
  @ApiOkResponse({
    description: 'The rendered export. Content-Type follows ?format.',
    content: {
      'text/csv': { schema: { type: 'string' } },
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { type: 'string', format: 'binary' },
      },
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ExportTypeParamDto,
    @Query() query: ExportQueryDto,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const dataset = params.type;
    const fmt = (query.format ?? 'CSV') as ExportFormat;
    const { from, to, screenId, status } = query;

    // `report:read` (the guard above) is held by VIEWER, so it cannot be the
    // only gate: the audit trail and the billing ledger need the same authority
    // here that their interactive routes demand. Asserted BEFORE any query runs.
    this.exports.assertDatasetAccess(user, dataset);

    const scope = { companyId: user.companyId, isSuperAdmin: user.isSuperAdmin };
    const data = await this.exports.dataset(scope, dataset, { from, to, screenId, status });
    const out = await this.exports.render(data, fmt, dataset);

    await this.activityLog.log({
      action: 'export.generated',
      category: 'EXPORT',
      actorId: user.userId,
      companyId: user.companyId,
      metadata: { dataset, format: fmt, rows: data.rows.length },
    });

    res!.setHeader('Content-Type', out.contentType);
    res!.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    return out.body;
  }
}
