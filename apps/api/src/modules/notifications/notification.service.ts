import { Injectable } from '@nestjs/common';
import { NotificationSeverity, Prisma } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListNotificationsQueryDto } from './dto/notifications.dto';

export interface CreateNotificationInput {
  userId: string;
  companyId: string | null;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body?: string | null;
  channels?: string[];
  data?: Record<string, unknown>;
  emailedAt?: Date | null;
}

/**
 * In-dashboard notifications (Phase 10). Reuses the existing Notification model
 * (user-scoped). Read/unread tracked per row; a notification only ever belongs
 * to one user, so listing/marking is strictly scoped to the caller.
 */
@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateNotificationInput) {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        companyId: input.companyId,
        type: input.type,
        severity: input.severity,
        title: input.title,
        body: input.body ?? null,
        channels: input.channels ?? ['in_app'],
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        emailedAt: input.emailedAt ?? null,
      },
    });
  }

  async list(userId: string, query: ListNotificationsQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.NotificationWhereInput = { userId };
    if (query.unreadOnly) where.readAt = null;
    const [rows, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items: rows.map((r) => this.toView(r)), meta: meta(total), unreadCount: unread };
  }

  async unreadCount(userId: string): Promise<{ unreadCount: number }> {
    const unreadCount = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { unreadCount };
  }

  /** Mark one of the caller's notifications read (scoped — cannot touch others'). */
  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true, updated: res.count };
  }

  private toView(n: Prisma.NotificationGetPayload<true>) {
    return {
      id: n.id,
      type: n.type,
      severity: n.severity,
      title: n.title,
      body: n.body,
      data: n.data,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    };
  }
}
