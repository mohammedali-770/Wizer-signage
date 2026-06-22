import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import {
  ListNotificationsQueryDto,
  UpdateNotificationPreferencesDto,
} from './dto/notifications.dto';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationService } from './notification.service';

/**
 * Per-user dashboard notifications + notification preferences (Phase 10). Always
 * scoped to the authenticated user — no cross-user access. No special permission
 * beyond authentication (a user manages their own notifications).
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly preferences: NotificationPreferenceService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List the caller's notifications (paginated; ?unreadOnly)." })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(user.userId, query);
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(user.userId);
  }

  @Get('preferences')
  listPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.preferences.list(user.userId);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update notification preferences (channel/event opt in/out).' })
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.preferences.update(user.userId, user.companyId, dto.preferences);
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.markRead(user.userId, id);
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.userId);
  }
}
