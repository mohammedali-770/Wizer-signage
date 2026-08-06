import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ApiPaginatedResponse,
  OkResponseDto,
  OkUpdatedResponseDto,
} from '../../common/dto/api-response.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import {
  ListNotificationsQueryDto,
  UpdateNotificationPreferencesDto,
} from './dto/notifications.dto';
import {
  NotificationDto,
  NotificationPreferenceDto,
  UnreadCountDto,
} from './dto/notifications-response.dto';
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
  // NOT the bare envelope: this list also returns `unreadCount`, and it is the
  // field the bell badge reads.
  @ApiPaginatedResponse(NotificationDto, {
    unreadCount: {
      type: 'number',
      description: "The caller's total unread count, IGNORING ?unreadOnly and the page.",
    },
  })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(user.userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread count for the bell badge.' })
  @ApiOkResponse({ type: UnreadCountDto })
  unread(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(user.userId);
  }

  @Get('preferences')
  @ApiOperation({ summary: "The caller's notification preferences." })
  // An absent row means the default applies, so an empty array is 'everything
  // at its default', not 'everything off'.
  @ApiOkResponse({ type: [NotificationPreferenceDto] })
  listPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.preferences.list(user.userId);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update notification preferences (channel/event opt in/out).' })
  // Returns the full preference list, not just what changed.
  @ApiOkResponse({ type: [NotificationPreferenceDto] })
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.preferences.update(user.userId, user.companyId, dto.preferences);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark one notification read.' })
  @ApiOkResponse({ type: OkResponseDto })
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.markRead(user.userId, id);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: "Mark all of the caller's notifications read." })
  @ApiOkResponse({ type: OkUpdatedResponseDto })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.userId);
  }
}
