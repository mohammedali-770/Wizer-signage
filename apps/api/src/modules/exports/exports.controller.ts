import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ExportService, type ExportDataset, type ExportFormat } from './export.service';

const DATASETS: ExportDataset[] = [
  'proof-of-play',
  'screen-health',
  'alerts',
  'activity-logs',
  'screens',
  'locations',
  'companies',
  'invoices',
];
const FORMATS: ExportFormat[] = ['CSV', 'XLSX', 'PDF'];

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
  @ApiOperation({
    summary: 'Export a dataset as CSV/XLSX/PDF (?format, ?from, ?to, ?screenId, ?status).',
  })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type') type: string,
    @Query('format') format = 'CSV',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('screenId') screenId?: string,
    @Query('status') status?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const dataset = type as ExportDataset;
    const fmt = String(format).toUpperCase() as ExportFormat;
    if (!DATASETS.includes(dataset))
      throw new BadRequestException(`Unknown export type "${type}".`);
    if (!FORMATS.includes(fmt)) throw new BadRequestException(`Unknown format "${format}".`);

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
