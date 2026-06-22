import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { NotificationPreferenceItemDto } from './dto/notifications.dto';
import { defaultChannelEnabled } from './notifications.constants';

/**
 * Per-user notification preferences (Phase 10). A missing row means "use the
 * system default" for that (channel, event) pair, so the preference set is the
 * foundation, not an exhaustive matrix.
 */
@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: [{ channel: 'asc' }, { eventType: 'asc' }],
    });
  }

  /** Upsert a batch of the caller's preferences. */
  async update(userId: string, companyId: string | null, items: NotificationPreferenceItemDto[]) {
    for (const item of items) {
      await this.prisma.notificationPreference.upsert({
        where: {
          userId_channel_eventType: { userId, channel: item.channel, eventType: item.eventType },
        },
        create: {
          userId,
          companyId,
          channel: item.channel,
          eventType: item.eventType,
          enabled: item.enabled,
        },
        update: { enabled: item.enabled, companyId },
      });
    }
    return this.list(userId);
  }

  /** Effective on/off for a (user, channel, event), falling back to the default. */
  async isEnabled(
    userId: string,
    channel: NotificationChannel,
    eventType: string,
  ): Promise<boolean> {
    const row = await this.prisma.notificationPreference.findUnique({
      where: { userId_channel_eventType: { userId, channel, eventType } },
      select: { enabled: true },
    });
    if (row) return row.enabled;
    return defaultChannelEnabled(
      channel === NotificationChannel.EMAIL ? 'EMAIL' : 'DASHBOARD',
      eventType,
    );
  }
}
