import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AlertStatus,
  NotificationChannel,
  NotificationSeverity,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import type { ListAlertsQueryDto } from './dto/notifications.dto';
import { EmailService } from './email.service';
import { NotificationService } from './notification.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { CHANNEL_EMAIL, CHANNEL_IN_APP, DEFAULT_SEVERITY } from './notifications.constants';

export interface RaiseAlertInput {
  companyId: string | null;
  screenId?: string | null;
  deviceId?: string | null;
  type: string;
  severity?: NotificationSeverity;
  title: string;
  message?: string;
  metadata?: Record<string, unknown>;
  /** Override the dedup key (default `${companyId}:${screenId}:${type}`). */
  dedupeKey?: string;
  /**
   * Informational events (e.g. "back online", "emergency ended") still notify
   * users but are created already-RESOLVED so they never linger in the OPEN
   * alerts list.
   */
  informational?: boolean;
}

const OPEN_STATES: AlertStatus[] = [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED];

/**
 * How long an unacknowledged CRITICAL alert stays quiet before it notifies
 * again. Dedup exists to stop per-sweep spam, but a CRITICAL that notifies
 * exactly once means one missed email hides the condition forever (e.g.
 * "backups have stopped"). Acknowledging an alert silences the re-notification.
 */
const CRITICAL_RENOTIFY_MS = 24 * 60 * 60 * 1000;

/**
 * Operational alerts (Phase 10). De-duplicated while unresolved so repeated
 * conditions (e.g. an offline screen seen on every sweep) update one row rather
 * than spamming. A NEW alert fans out to dashboard notifications + (curated)
 * emails for the relevant recipients. Conditions auto-resolve via resolveByKey.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly notifications: NotificationService,
    private readonly email: EmailService,
    private readonly preferences: NotificationPreferenceService,
  ) {}

  // --- Raise / resolve (used by event hooks + the maintenance sweep) ------

  /** Raise (or refresh) an alert. Returns whether a NEW alert was created. */
  async raise(input: RaiseAlertInput): Promise<{ alertId: string; created: boolean }> {
    const dedupeKey = input.dedupeKey ?? this.defaultKey(input);
    const severity = input.severity ?? DEFAULT_SEVERITY[input.type] ?? NotificationSeverity.WARNING;

    const existing = await this.prisma.alert.findFirst({
      where: { dedupeKey, status: { in: OPEN_STATES } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, lastNotifiedAt: true, acknowledgedAt: true },
    });
    if (existing) {
      // Refresh the existing unresolved alert. Dedup keeps this quiet by design
      // (anti-spam) — EXCEPT for a CRITICAL that nobody has acknowledged: those
      // must page again on a cadence, otherwise a single missed email means the
      // condition (e.g. "backups have stopped") is never surfaced again.
      const staleSince = Date.now() - CRITICAL_RENOTIFY_MS;
      const shouldRenotify =
        severity === NotificationSeverity.CRITICAL &&
        !existing.acknowledgedAt &&
        (existing.lastNotifiedAt === null || existing.lastNotifiedAt.getTime() <= staleSince);

      const refreshed = await this.prisma.alert.update({
        where: { id: existing.id },
        data: {
          triggeredAt: new Date(),
          message: input.message,
          severity,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
      if (shouldRenotify) {
        await this.dispatch(refreshed);
      }
      return { alertId: existing.id, created: false };
    }

    const alert = await this.prisma.alert.create({
      data: {
        companyId: input.companyId,
        screenId: input.screenId ?? null,
        deviceId: input.deviceId ?? null,
        type: input.type,
        severity,
        // Informational events are recorded already-resolved so they don't sit
        // in the OPEN list, but still fan out a notification below.
        status: input.informational ? AlertStatus.RESOLVED : AlertStatus.OPEN,
        title: input.title,
        message: input.message ?? null,
        dedupeKey,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        resolvedAt: input.informational ? new Date() : null,
      },
    });
    await this.dispatch(alert);
    return { alertId: alert.id, created: true };
  }

  /** Auto-resolve any OPEN/ACKNOWLEDGED alerts matching a dedup key (condition cleared). */
  async resolveByKey(dedupeKey: string): Promise<number> {
    const res = await this.prisma.alert.updateMany({
      where: { dedupeKey, status: { in: OPEN_STATES } },
      data: { status: AlertStatus.RESOLVED, resolvedAt: new Date() },
    });
    return res.count;
  }

  /** Convenience: build the canonical key for a screen-scoped condition. */
  screenKey(companyId: string | null, screenId: string | null, type: string): string {
    return `${companyId ?? 'system'}:${screenId ?? ''}:${type}`;
  }

  // --- Dashboard management ----------------------------------------------

  async list(
    scope: { companyId: string | null; isSuperAdmin: boolean },
    query: ListAlertsQueryDto,
  ) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.AlertWhereInput = {};
    // Tenant isolation: company users only ever see their own company's alerts.
    // Super Admins see platform/system alerts (companyId null) by default, and
    // may drill into a specific company via ?companyId.
    where.companyId = scope.isSuperAdmin ? (query.companyId ?? null) : scope.companyId;
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.type) where.type = query.type;
    if (query.screenId) where.screenId = query.screenId;
    if (query.from || query.to) {
      where.triggeredAt = {};
      if (query.from) where.triggeredAt.gte = new Date(query.from);
      if (query.to) where.triggeredAt.lte = new Date(query.to);
    }
    const [rows, total, open] = await this.prisma.$transaction([
      this.prisma.alert.findMany({
        where,
        orderBy: [{ status: 'asc' }, { triggeredAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.alert.count({ where }),
      this.prisma.alert.count({ where: { ...where, status: AlertStatus.OPEN } }),
    ]);
    return { items: rows.map((r) => this.toView(r)), meta: meta(total), openCount: open };
  }

  async acknowledge(
    scope: { companyId: string | null; isSuperAdmin: boolean },
    actor: AuthenticatedUser,
    id: string,
  ) {
    const alert = await this.loadOwned(scope, id);
    if (alert.status === AlertStatus.OPEN) {
      await this.prisma.alert.update({
        where: { id },
        data: {
          status: AlertStatus.ACKNOWLEDGED,
          acknowledgedAt: new Date(),
          acknowledgedById: actor.userId,
        },
      });
    }
    await this.log(actor, alert.companyId, 'alert.acknowledged', id);
    return this.getView(id);
  }

  async resolve(
    scope: { companyId: string | null; isSuperAdmin: boolean },
    actor: AuthenticatedUser,
    id: string,
  ) {
    const alert = await this.loadOwned(scope, id);
    await this.prisma.alert.update({
      where: { id },
      data: { status: AlertStatus.RESOLVED, resolvedAt: new Date() },
    });
    await this.log(actor, alert.companyId, 'alert.resolved', id);
    return this.getView(id);
  }

  async dismiss(
    scope: { companyId: string | null; isSuperAdmin: boolean },
    actor: AuthenticatedUser,
    id: string,
  ) {
    const alert = await this.loadOwned(scope, id);
    await this.prisma.alert.update({
      where: { id },
      data: { status: AlertStatus.DISMISSED, resolvedAt: new Date() },
    });
    await this.log(actor, alert.companyId, 'alert.dismissed', id);
    return this.getView(id);
  }

  // --- Internals ----------------------------------------------------------

  private defaultKey(input: RaiseAlertInput): string {
    return `${input.companyId ?? 'system'}:${input.screenId ?? ''}:${input.type}`;
  }

  /**
   * Notify the relevant users (dashboard + curated email) about a NEW alert, or
   * re-notify a persistent unacknowledged CRITICAL. Stamps `lastNotifiedAt` so
   * the re-notification cadence is driven by when we actually notified, not by
   * when the condition was last observed.
   */
  private async dispatch(alert: Prisma.AlertGetPayload<true>): Promise<void> {
    try {
      // Stamp first: if fan-out partially fails we must not re-notify on the
      // very next sweep (that would spam every 5 minutes).
      await this.prisma.alert
        .update({ where: { id: alert.id }, data: { lastNotifiedAt: new Date() } })
        .catch((error: unknown) => {
          this.logger.warn(
            `Could not stamp lastNotifiedAt on alert ${alert.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });

      const recipients = await this.recipientUsers(alert.companyId);
      for (const user of recipients) {
        // Per-recipient isolation: one user's notification/email failure must
        // not stop the others from being notified.
        try {
          await this.dispatchToUser(user, alert);
        } catch (e) {
          this.logger.warn(
            `Alert ${alert.id} dispatch to ${user.id} failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    } catch (error) {
      // Notification fan-out is best-effort; never let it break the trigger.
      this.logger.warn(
        `Alert dispatch failed for ${alert.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async dispatchToUser(
    user: { id: string; email: string },
    alert: Prisma.AlertGetPayload<true>,
  ): Promise<void> {
    const dashboard = await this.preferences.isEnabled(
      user.id,
      NotificationChannel.DASHBOARD,
      alert.type,
    );
    const email = await this.preferences.isEnabled(user.id, NotificationChannel.EMAIL, alert.type);
    const channels: string[] = [];
    if (dashboard) channels.push(CHANNEL_IN_APP);
    if (email) channels.push(CHANNEL_EMAIL);

    if (dashboard) {
      await this.notifications.create({
        userId: user.id,
        companyId: alert.companyId,
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        body: alert.message,
        channels,
        data: { alertId: alert.id, screenId: alert.screenId },
        emailedAt: email ? new Date() : null,
      });
    }
    if (email) {
      await this.email.sendEvent({
        companyId: alert.companyId,
        to: user.email,
        type: alert.type,
        subject: `[${alert.severity}] ${alert.title}`,
        text: `${alert.title}\n\n${alert.message ?? ''}`.trim(),
      });
    }
  }

  private async recipientUsers(
    companyId: string | null,
  ): Promise<Array<{ id: string; email: string }>> {
    if (companyId) {
      return this.prisma.user.findMany({
        where: {
          companyId,
          status: UserStatus.ACTIVE,
          role: { in: [UserRole.COMPANY_ADMIN, UserRole.LOCATION_MANAGER] },
        },
        select: { id: true, email: true },
      });
    }
    // System/platform alerts → super admins.
    return this.prisma.user.findMany({
      where: { role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE },
      select: { id: true, email: true },
    });
  }

  private async loadOwned(scope: { companyId: string | null; isSuperAdmin: boolean }, id: string) {
    const alert = await this.prisma.alert.findFirst({
      where: { id, companyId: scope.isSuperAdmin ? null : scope.companyId },
      select: { id: true, companyId: true, status: true },
    });
    if (!alert) throw new NotFoundException('Alert not found.');
    return alert;
  }

  private async getView(id: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    return alert ? this.toView(alert) : null;
  }

  private async log(
    actor: AuthenticatedUser,
    companyId: string | null,
    action: string,
    id: string,
  ) {
    await this.activityLog.log({
      action,
      category: 'ALERT',
      actorId: actor.userId,
      companyId,
      targetType: 'alert',
      targetId: id,
    });
  }

  private toView(a: Prisma.AlertGetPayload<true>) {
    return {
      id: a.id,
      companyId: a.companyId,
      screenId: a.screenId,
      deviceId: a.deviceId,
      type: a.type,
      severity: a.severity,
      status: a.status,
      title: a.title,
      message: a.message,
      metadata: a.metadata,
      triggeredAt: a.triggeredAt.toISOString(),
      acknowledgedAt: a.acknowledgedAt ? a.acknowledgedAt.toISOString() : null,
      acknowledgedById: a.acknowledgedById,
      resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    };
  }
}
