import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import { MonitoringService } from './monitoring.service';

/** Fleet monitoring overview (Phase 8). Company-scoped, read-only. */
@ApiTags('monitoring')
@ApiBearerAuth()
@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('overview')
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'Fleet status counts, sync breakdown, alerts, and per-screen status.' })
  overview(@CurrentCompany() companyId: string) {
    return this.monitoring.overview(companyId);
  }
}
