import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ActivityLogService } from './activity-log.service';
import { QueryActivityLogDto } from './dto/query-activity-log.dto';

@ApiTags('activity-logs')
@ApiBearerAuth()
@Controller('activity-logs')
export class ActivityLogController {
  constructor(private readonly activityLog: ActivityLogService) {}

  @Get()
  @RequirePermissions(Permission.ActivityRead)
  @ApiOperation({ summary: 'List audit/activity logs (tenant-scoped).' })
  async list(@Query() query: QueryActivityLogDto, @CurrentUser() user: AuthenticatedUser) {
    return this.activityLog.query({
      companyId: user.companyId,
      isSuperAdmin: user.isSuperAdmin,
      page: query.page,
      pageSize: query.pageSize,
      action: query.action,
      category: query.category,
      actorId: query.actorId,
      from: query.from,
      to: query.to,
    });
  }
}
