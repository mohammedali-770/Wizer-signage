import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import { MonitoringOverviewPaginatedDto } from './dto/monitoring-overview-paginated.dto';
import { MonitoringOverviewQueryDto } from './dto/monitoring-query.dto';
import { MonitoringService } from './monitoring.service';

/** Fleet monitoring overview (Phase 8). Company-scoped, read-only. */
@ApiTags('monitoring')
@ApiBearerAuth()
@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('overview')
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({
    summary:
      'Whole-fleet status counts plus a paginated screen list and bounded live alert candidates.',
  })
  @ApiOkResponse({ type: MonitoringOverviewPaginatedDto })
  overview(@CurrentCompany() companyId: string, @Query() query: MonitoringOverviewQueryDto) {
    return this.monitoring.overview(companyId, query);
  }
}
