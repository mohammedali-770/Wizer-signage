import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContentStatus,
  DeviceStatus,
  NotificationSeverity,
  ScreenStatus,
  SubscriptionStatus,
} from '@prisma/client';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { EmergencyBroadcastService } from '../emergency/emergency-broadcast.service';
import { AlertService } from '../notifications/alert.service';
import { AlertEvent } from '../notifications/notifications.constants';
import { ScheduledReportService } from '../scheduled-reports/scheduled-report.service';
import { UsageLimitsService } from '../usage-limits/usage-limits.service';
import { BackupService } from './backup.service';
import { RetentionService } from './retention.service';

const SUBSCRIPTION_EXPIRY_WARN_DAYS = 14;
const GRACE_ENDING_WARN_DAYS = 2;
const CONTENT_EXPIRY_WARN_DAYS = 7;

/**
 * Cursor-paginated sweep sizing.
 *
 * The sweeps previously loaded one flat `take: N` page and stopped. That is a
 * SILENT correctness failure, not just a performance one: past the cap, screens
 * simply never get an offline alert and companies never get a subscription,
 * grace, storage, or content-expiry alert — and nothing says so. It is also the
 * cap that hurts most at the scale it triggers, because that is exactly when a
 * missed alert matters.
 *
 * Paging by `id` instead keeps each round trip small (so no single query can
 * exceed the statement timeout) while covering the whole table. MAX_PAGES is a
 * runaway backstop, not a business limit — hitting it is logged as a warning
 * and reported in the result, never swallowed.
 */
const SWEEP_PAGE = 1_000;
const MAX_PAGES = 500; // 500k rows per sweep target

/**
 * Operational maintenance (Phase 10). Two responsibilities:
 *  1. `sweep()` — reconcile time/threshold-based alerts that have no event hook
 *     (offline screens, subscription expiry, grace ending, storage limits,
 *     content expiring). Deduplicated + auto-resolving, so it is safe to run
 *     repeatedly without spamming.
 *  2. `runAll()` — the cron entrypoint: sweep + retention cleanup + emergency
 *     auto-END + due scheduled reports + backup-recency check.
 *
 * Driven by the maintenance CLI/cron, not an in-process scheduler.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly alerts: AlertService,
    private readonly retention: RetentionService,
    private readonly backup: BackupService,
    private readonly emergency: EmergencyBroadcastService,
    private readonly scheduledReports: ScheduledReportService,
    private readonly usageLimits: UsageLimitsService,
  ) {}

  private retentionDays(): number {
    return this.config.get<AppConfig['retention']>('retention', { infer: true })?.days ?? 90;
  }

  /** Dispatch a single named job (used by the controller + CLI). */
  async run(
    job: 'all' | 'sweep' | 'retention' | 'reports' | 'emergencies' | 'backup-check' = 'all',
    now: Date = new Date(),
  ) {
    switch (job) {
      case 'sweep':
        return { sweep: await this.sweep(now) };
      case 'retention':
        return {
          retention: await this.retention.run({ retentionDays: this.retentionDays(), now }),
        };
      case 'reports':
        return { scheduledReports: await this.scheduledReports.runDue(now) };
      case 'emergencies':
        return { autoEndedEmergencies: (await this.emergency.endExpired(now)).length };
      case 'backup-check':
        return { backupStale: await this.backup.checkRecency(now) };
      default:
        return this.runAll(now);
    }
  }

  async runAll(now: Date = new Date()) {
    const sweep = await this.sweep(now);
    const retention = await this.retention.run({ retentionDays: this.retentionDays(), now });
    const autoEndedEmergencies = await this.emergency.endExpired(now);
    const scheduledReports = await this.scheduledReports.runDue(now);
    const backupStale = await this.backup.checkRecency(now);
    const result = {
      sweep,
      retention,
      autoEndedEmergencies: autoEndedEmergencies.length,
      scheduledReports,
      backupStale,
    };
    this.logger.log(`Maintenance runAll: ${JSON.stringify(result)}`);
    return result;
  }

  /** Reconcile threshold/time-based alerts. Returns the counts raised. */
  async sweep(now: Date = new Date()) {
    const offlineScreens = await this.sweepOfflineScreens(now);
    const companyChecks = await this.sweepCompanies(now);
    return { offlineScreens, ...companyChecks };
  }

  // --- Offline screens ----------------------------------------------------

  private async sweepOfflineScreens(now: Date): Promise<number> {
    let raised = 0;
    const screens = await this.paginate('offlineScreens', (cursor) =>
      this.prisma.screen.findMany({
        where: {
          deletedAt: null,
          status: {
            notIn: [
              ScreenStatus.DISABLED,
              ScreenStatus.ARCHIVED,
              ScreenStatus.UNPAIRED,
              ScreenStatus.PAIRING,
            ],
          },
          device: { is: { status: DeviceStatus.ACTIVE } },
        },
        select: {
          id: true,
          companyId: true,
          name: true,
          lastHeartbeatAt: true,
          heartbeatIntervalSeconds: true,
        },
        orderBy: { id: 'asc' },
        take: SWEEP_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );

    for (const s of screens) {
      const intervalMs = (s.heartbeatIntervalSeconds || 60) * 3 * 1000;
      const offline =
        !s.lastHeartbeatAt || s.lastHeartbeatAt.getTime() < now.getTime() - intervalMs;
      if (!offline) continue;
      const { created } = await this.alerts.raise({
        companyId: s.companyId,
        screenId: s.id,
        type: AlertEvent.ScreenOffline,
        severity: NotificationSeverity.CRITICAL,
        title: `Screen offline: ${s.name}`,
        message: s.lastHeartbeatAt
          ? `No heartbeat since ${s.lastHeartbeatAt.toISOString()}.`
          : 'Never reported a heartbeat.',
        dedupeKey: this.alerts.screenKey(s.companyId, s.id, AlertEvent.ScreenOffline),
      });
      if (created) raised++;
    }
    return raised;
  }

  /**
   * Read a whole table in id-ordered pages.
   *
   * Keyset pagination (`cursor` + `skip: 1`), not OFFSET: OFFSET makes page N
   * cost O(N x page) and would degrade the sweep as the fleet grows, which is
   * the opposite of what a maintenance job needs.
   */
  private async paginate<T extends { id: string }>(
    label: string,
    page: (cursor: string | undefined) => Promise<T[]>,
  ): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | undefined;

    for (let i = 0; i < MAX_PAGES; i++) {
      const rows = await page(cursor);
      all.push(...rows);
      const last = rows[rows.length - 1];
      if (rows.length < SWEEP_PAGE || !last) return all;
      cursor = last.id;
    }

    this.logger.warn(
      `Maintenance sweep "${label}" stopped at the ${MAX_PAGES * SWEEP_PAGE}-row backstop; ` +
        'the remainder was NOT swept. Raise MAX_PAGES or shard the job.',
    );
    return all;
  }

  // --- Subscriptions / grace / storage / content (per company) ------------

  private async sweepCompanies(now: Date) {
    const companies = await this.paginate('companies', (cursor) =>
      this.prisma.company.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          subscription: {
            select: {
              status: true,
              currentPeriodEnd: true,
              trialEndsAt: true,
              gracePeriodEndsAt: true,
            },
          },
        },
        orderBy: { id: 'asc' },
        take: SWEEP_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );

    let subscriptionAlerts = 0;
    let storageAlerts = 0;
    let contentExpiring = 0;

    for (const company of companies) {
      subscriptionAlerts += await this.sweepSubscription(
        company.id,
        company.name,
        company.subscription,
        now,
      );
      storageAlerts += await this.sweepUsage(company.id, company.name);
      contentExpiring += await this.sweepContentExpiry(company.id, now);
    }
    return { subscriptionAlerts, storageAlerts, contentExpiring };
  }

  private async sweepSubscription(
    companyId: string,
    name: string,
    sub: {
      status: SubscriptionStatus;
      currentPeriodEnd: Date | null;
      trialEndsAt: Date | null;
      gracePeriodEndsAt: Date | null;
    } | null,
    now: Date,
  ): Promise<number> {
    if (!sub) return 0;
    let raised = 0;
    const days = (d: Date) => (d.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);

    const expiry =
      sub.status === SubscriptionStatus.TRIALING ? sub.trialEndsAt : sub.currentPeriodEnd;
    const expiredKey = `${companyId}::${AlertEvent.SubscriptionExpired}`;
    const expiringKey = `${companyId}::${AlertEvent.SubscriptionExpiring}`;

    if (sub.status === SubscriptionStatus.EXPIRED || (expiry && days(expiry) < 0)) {
      const { created } = await this.alerts.raise({
        companyId,
        type: AlertEvent.SubscriptionExpired,
        severity: NotificationSeverity.CRITICAL,
        title: `Subscription expired: ${name}`,
        message: 'The subscription has expired. Renew to avoid service interruption.',
        dedupeKey: expiredKey,
      });
      if (created) raised++;
      await this.alerts.resolveByKey(expiringKey);
    } else if (expiry && days(expiry) <= SUBSCRIPTION_EXPIRY_WARN_DAYS) {
      const { created } = await this.alerts.raise({
        companyId,
        type: AlertEvent.SubscriptionExpiring,
        title: `Subscription expiring soon: ${name}`,
        message: `The subscription ${sub.status === SubscriptionStatus.TRIALING ? 'trial ' : ''}ends on ${expiry.toISOString().slice(0, 10)}.`,
        dedupeKey: expiringKey,
      });
      if (created) raised++;
    } else {
      await this.alerts.resolveByKey(expiringKey);
      await this.alerts.resolveByKey(expiredKey);
    }

    // Grace period ending.
    const graceKey = `${companyId}::${AlertEvent.GraceEnding}`;
    if (
      sub.gracePeriodEndsAt &&
      days(sub.gracePeriodEndsAt) >= 0 &&
      days(sub.gracePeriodEndsAt) <= GRACE_ENDING_WARN_DAYS
    ) {
      const { created } = await this.alerts.raise({
        companyId,
        type: AlertEvent.GraceEnding,
        title: `Plan grace period ending: ${name}`,
        message: `The grace period ends on ${sub.gracePeriodEndsAt.toISOString().slice(0, 10)}; resolve overages to avoid blocking.`,
        dedupeKey: graceKey,
      });
      if (created) raised++;
    } else {
      await this.alerts.resolveByKey(graceKey);
    }
    return raised;
  }

  private async sweepUsage(companyId: string, name: string): Promise<number> {
    const evaluation = await this.usageLimits.evaluate(companyId).catch(() => null);
    if (!evaluation) return 0;
    let raised = 0;
    const storage = evaluation.resources.find((r) => r.key === 'storageGb');
    const exceededKey = `${companyId}::${AlertEvent.StorageExceeded}`;
    const nearKey = `${companyId}::${AlertEvent.StorageNearLimit}`;

    if (storage?.exceeded) {
      const { created } = await this.alerts.raise({
        companyId,
        type: AlertEvent.StorageExceeded,
        severity: NotificationSeverity.CRITICAL,
        title: `Storage limit exceeded: ${name}`,
        message: `Storage is at ${Math.round(storage.percentUsed ?? 100)}% of the plan limit.`,
        dedupeKey: exceededKey,
      });
      if (created) raised++;
      await this.alerts.resolveByKey(nearKey);
    } else if (storage?.approaching) {
      const { created } = await this.alerts.raise({
        companyId,
        type: AlertEvent.StorageNearLimit,
        title: `Storage near limit: ${name}`,
        message: `Storage is at ${Math.round(storage.percentUsed ?? 80)}% of the plan limit.`,
        dedupeKey: nearKey,
      });
      if (created) raised++;
    } else {
      await this.alerts.resolveByKey(nearKey);
      await this.alerts.resolveByKey(exceededKey);
    }

    // Overall plan-limit exceeded (any resource).
    const planKey = `${companyId}::${AlertEvent.PlanLimitExceeded}`;
    if (
      evaluation.status === 'exceeded' ||
      evaluation.status === 'blocked' ||
      evaluation.status === 'grace'
    ) {
      const exceeded = evaluation.resources.filter((r) => r.exceeded).map((r) => r.key);
      if (exceeded.length) {
        const { created } = await this.alerts.raise({
          companyId,
          type: AlertEvent.PlanLimitExceeded,
          severity:
            evaluation.status === 'blocked'
              ? NotificationSeverity.CRITICAL
              : NotificationSeverity.WARNING,
          title: `Plan limit exceeded: ${name}`,
          message: `Over the plan limit for: ${exceeded.join(', ')}.`,
          dedupeKey: planKey,
        });
        if (created) raised++;
      }
    } else {
      await this.alerts.resolveByKey(planKey);
    }
    return raised;
  }

  private async sweepContentExpiry(companyId: string, now: Date): Promise<number> {
    const horizon = new Date(now.getTime() + CONTENT_EXPIRY_WARN_DAYS * 24 * 60 * 60 * 1000);
    const count = await this.prisma.content.count({
      where: {
        companyId,
        deletedAt: null,
        status: ContentStatus.ACTIVE,
        expiresAt: { not: null, gt: now, lte: horizon },
      },
    });
    const key = `${companyId}::${AlertEvent.ContentExpiring}`;
    if (count > 0) {
      const { created } = await this.alerts.raise({
        companyId,
        type: AlertEvent.ContentExpiring,
        severity: NotificationSeverity.INFO,
        title: 'Content expiring soon',
        message: `${count} content item(s) expire within ${CONTENT_EXPIRY_WARN_DAYS} days.`,
        metadata: { count },
        dedupeKey: key,
      });
      return created ? 1 : 0;
    }
    await this.alerts.resolveByKey(key);
    return 0;
  }
}
