import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import { FleetHealthSummaryDto } from './fleet-health.dto';
import { FleetHealthService } from './fleet-health.service';

@ApiTags('Monitoring')
@ApiBearerAuth()
@Controller('monitoring/fleet-health')
export class FleetHealthController {
  constructor(private readonly fleet: FleetHealthService) {}

  @Get()
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'Get company player-version distribution and recent crash diagnostics' })
  @ApiOkResponse({ type: FleetHealthSummaryDto })
  summary(@CurrentCompany() companyId: string): Promise<FleetHealthSummaryDto> {
    return this.fleet.summary(companyId);
  }
}
