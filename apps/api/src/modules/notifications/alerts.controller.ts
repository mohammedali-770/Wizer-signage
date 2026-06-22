import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { AlertService } from './alert.service';
import { ListAlertsQueryDto } from './dto/notifications.dto';

/**
 * Operational alerts (Phase 10). Reads require `alert:read`; acknowledge/resolve/
 * dismiss require `alert:manage`. Company users only ever see their company's
 * alerts; Super Admins see platform/system alerts.
 */
@ApiTags('alerts')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertService) {}

  private scope(user: AuthenticatedUser) {
    return { companyId: user.companyId, isSuperAdmin: user.isSuperAdmin };
  }

  @Get()
  @RequirePermissions(Permission.AlertRead)
  @ApiOperation({ summary: 'List alerts (filter by status/severity/type/screen/date).' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAlertsQueryDto) {
    return this.alerts.list(this.scope(user), query);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @RequirePermissions(Permission.AlertManage)
  acknowledge(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.alerts.acknowledge(this.scope(user), user, id);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions(Permission.AlertManage)
  resolve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.alerts.resolve(this.scope(user), user, id);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @RequirePermissions(Permission.AlertManage)
  dismiss(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.alerts.dismiss(this.scope(user), user, id);
  }
}
