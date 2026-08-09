import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import { FleetHealthService } from './fleet-health.service';

@ApiExcludeController()
@ApiBearerAuth()
@Controller('monitoring/fleet-health')
export class FleetHealthController {
  constructor(private readonly fleet: FleetHealthService) {}

  @Get()
  @RequirePermissions(Permission.ScreenRead)
  summary(@CurrentCompany() companyId: string) {
    return this.fleet.summary(companyId);
  }
}
