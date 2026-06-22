import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import { ProofOfPlayQueryDto } from './dto/proof-of-play.dto';
import { ProofOfPlayService } from './proof-of-play.service';

/**
 * Dashboard proof-of-play reporting (Phase 9). Company-scoped + RBAC
 * (`report:read`, held by Viewers too). Read-only: only the device endpoint
 * ever creates events.
 */
@ApiTags('proof-of-play')
@ApiBearerAuth()
@Controller('proof-of-play')
export class ProofOfPlayController {
  constructor(private readonly proofOfPlay: ProofOfPlayService) {}

  @Get()
  @RequirePermissions(Permission.ReportRead)
  @ApiOperation({ summary: 'Proof-of-play events (paginated, filterable).' })
  report(@CurrentCompany() companyId: string, @Query() query: ProofOfPlayQueryDto) {
    return this.proofOfPlay.report(companyId, query);
  }

  @Get('summary')
  @RequirePermissions(Permission.ReportRead)
  @ApiOperation({
    summary: 'Aggregated proof-of-play summary (counts, duration, top content, failing screens).',
  })
  summary(@CurrentCompany() companyId: string, @Query() query: ProofOfPlayQueryDto) {
    return this.proofOfPlay.summary(companyId, query);
  }

  @Get('export.csv')
  @RequirePermissions(Permission.ReportRead)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="proof-of-play.csv"')
  @ApiOperation({ summary: 'Export filtered proof-of-play events as CSV.' })
  exportCsv(@CurrentCompany() companyId: string, @Query() query: ProofOfPlayQueryDto) {
    return this.proofOfPlay.exportCsv(companyId, query);
  }
}
