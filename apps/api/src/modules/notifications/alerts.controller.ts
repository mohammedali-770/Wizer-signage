import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiPaginatedResponse } from '../../common/dto/api-response.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { AlertService } from './alert.service';
import { AlertDto } from './dto/notifications-response.dto';
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
  // Also returns `openCount` alongside the envelope — see ApiPaginatedResponse.
  @ApiPaginatedResponse(AlertDto, {
    openCount: {
      type: 'number',
      description:
        'Alerts still OPEN in the caller\u2019s scope, ignoring the filters and the page.',
    },
  })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAlertsQueryDto) {
    return this.alerts.list(this.scope(user), query);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @RequirePermissions(Permission.AlertManage)
  @ApiOperation({ summary: 'Acknowledge an alert (records who, and when).' })
  // The service's return type is `AlertDto | null`, but the null is defensive,
  // not an outcome: `loadOwned` has already thrown 404 by this point, so a null
  // needs the row to vanish between two queries in the same request. Retention
  // is the only thing that deletes an alert. Documented as non-null — telling
  // every client to branch on a race they cannot observe would be worse than
  // the theoretical inaccuracy.
  @ApiOkResponse({ type: AlertDto })
  acknowledge(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.alerts.acknowledge(this.scope(user), user, id);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions(Permission.AlertManage)
  @ApiOperation({ summary: 'Resolve an alert.' })
  @ApiOkResponse({ type: AlertDto })
  resolve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.alerts.resolve(this.scope(user), user, id);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @RequirePermissions(Permission.AlertManage)
  @ApiOperation({ summary: 'Dismiss an alert without resolving the underlying condition.' })
  @ApiOkResponse({ type: AlertDto })
  dismiss(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.alerts.dismiss(this.scope(user), user, id);
  }
}
