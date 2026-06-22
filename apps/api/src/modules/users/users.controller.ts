import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { ListUsersQueryDto } from './dto/list-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Get()
  @RequirePermissions(Permission.UserRead)
  @ApiOperation({ summary: 'List users (tenant-scoped).' })
  list(@Query() query: ListUsersQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.users.list(user, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.UserRead)
  @ApiOperation({ summary: 'Get a user by id.' })
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.users.getView(user, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.UserUpdate)
  @ApiOperation({ summary: 'Update a user (name, role, status, locations).' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.users.update(user, id, dto);
    await this.activityLog.log({
      action: 'user.updated',
      category: ActivityCategory.USER,
      targetType: 'user',
      targetId: id,
      metadata: { changes: { ...dto } },
    });
    return result;
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequirePermissions(Permission.UserUpdate)
  @ApiOperation({ summary: 'Disable a user account.' })
  async disable(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.users.setStatus(user, id, UserStatus.DISABLED);
    await this.activityLog.log({
      action: 'user.disabled',
      category: ActivityCategory.USER,
      targetType: 'user',
      targetId: id,
    });
    return result;
  }

  @Post(':id/enable')
  @HttpCode(200)
  @RequirePermissions(Permission.UserUpdate)
  @ApiOperation({ summary: 'Re-enable a user account.' })
  async enable(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.users.setStatus(user, id, UserStatus.ACTIVE);
    await this.activityLog.log({
      action: 'user.enabled',
      category: ActivityCategory.USER,
      targetType: 'user',
      targetId: id,
    });
    return result;
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @RequirePermissions(Permission.UserUpdate)
  @ApiOperation({ summary: 'Manually unlock a locked-out account.' })
  async unlock(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.users.unlock(user, id);
    await this.activityLog.log({
      action: 'user.unlocked',
      category: ActivityCategory.SECURITY,
      targetType: 'user',
      targetId: id,
    });
    return result;
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(Permission.UserDelete)
  @ApiOperation({ summary: 'Delete (soft) a user account.' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.users.remove(user, id);
    await this.activityLog.log({
      action: 'user.deleted',
      category: ActivityCategory.USER,
      targetType: 'user',
      targetId: id,
    });
    return { deleted: true };
  }
}
