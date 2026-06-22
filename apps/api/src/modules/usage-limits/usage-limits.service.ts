import { ForbiddenException, Injectable } from '@nestjs/common';
import { GRACE_PERIOD_DAYS } from '@master-signage/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';

/** Typed shape of `Plan.limits` (a value of null/absent means "unlimited"). */
export interface PlanLimits {
  maxCompanies?: number | null;
  maxLocations?: number | null;
  maxScreens?: number | null;
  maxUsers?: number | null;
  storageGb?: number | null;
  maxFileSizeMb?: number | null;
  autoScreenshotsPerDay?: number | null;
  scheduledReports?: number | null;
  dataRetentionDays?: number | null;
  apiRequestsPerDay?: number | null;
  webhooks?: number | null;
}

export interface UsageCounts {
  locations: number;
  screens: number;
  users: number;
  /** Outstanding (non-expired) PENDING invitations — each reserves a user seat. */
  pendingInvitations: number;
  storageBytes: number;
  storageGb: number;
}

export type ResourceKey = 'locations' | 'screens' | 'users' | 'storageGb';

export interface ResourceUsage {
  key: ResourceKey;
  used: number;
  limit: number | null; // null = unlimited
  unlimited: boolean;
  exceeded: boolean;
  approaching: boolean; // >= 80% and not exceeded
  percentUsed: number | null;
}

export type UsageStatus = 'ok' | 'approaching' | 'exceeded' | 'grace' | 'blocked';

export interface UsageEvaluation {
  usage: UsageCounts;
  resources: ResourceUsage[];
  status: UsageStatus;
  gracePeriodEndsAt: Date | null;
  inGrace: boolean;
  graceExpired: boolean;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  limits: PlanLimits;
}

const APPROACHING_THRESHOLD = 0.8;

/** Round to 2 decimals for display (storage GB). */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class UsageLimitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** Live resource counts for a company (pending invitations reserve seats). */
  async computeUsage(companyId: string): Promise<UsageCounts> {
    const [locations, screens, users, pendingInvitations, storageAgg] =
      await this.prisma.$transaction([
        // Archived locations/screens don't consume quota.
        this.prisma.location.count({
          where: { companyId, deletedAt: null, status: { not: 'ARCHIVED' } },
        }),
        this.prisma.screen.count({
          where: { companyId, deletedAt: null, status: { not: 'ARCHIVED' } },
        }),
        this.prisma.user.count({ where: { companyId, deletedAt: null } }),
        this.prisma.invitation.count({
          where: { companyId, status: 'PENDING', expiresAt: { gt: new Date() } },
        }),
        this.prisma.content.aggregate({
          where: { companyId, deletedAt: null },
          _sum: { fileSize: true },
        }),
      ]);
    const storageBytes = Number(storageAgg._sum.fileSize ?? 0);
    return {
      locations,
      screens,
      users,
      pendingInvitations,
      storageBytes,
      storageGb: storageBytes / 1_000_000_000,
    };
  }

  private async getSubscription(companyId: string) {
    return this.prisma.subscription.findUnique({ where: { companyId }, include: { plan: true } });
  }

  /** Read-only evaluation of usage vs the company's effective plan limits. */
  async evaluate(companyId: string): Promise<UsageEvaluation> {
    const usage = await this.computeUsage(companyId);
    const subscription = await this.getSubscription(companyId);
    const limits = (subscription?.plan.limits ?? {}) as PlanLimits;

    const resources: ResourceUsage[] = [
      this.resource('locations', usage.locations, limits.maxLocations),
      this.resource('screens', usage.screens, limits.maxScreens),
      // A user seat is consumed by both an existing user and a pending invite.
      this.resource('users', usage.users + usage.pendingInvitations, limits.maxUsers),
      this.resource('storageGb', usage.storageGb, limits.storageGb),
    ];

    const anyExceeded = resources.some((r) => r.exceeded);
    const anyApproaching = resources.some((r) => r.approaching);
    const grace = subscription?.gracePeriodEndsAt ?? null;
    const inGrace = !!grace && grace.getTime() > Date.now();
    const graceExpired = !!grace && grace.getTime() <= Date.now();

    let status: UsageStatus = 'ok';
    if (anyExceeded) {
      status = graceExpired ? 'blocked' : inGrace ? 'grace' : 'exceeded';
    } else if (anyApproaching) {
      status = 'approaching';
    }

    return {
      usage,
      resources,
      status,
      gracePeriodEndsAt: grace,
      inGrace,
      graceExpired,
      planCode: subscription?.plan.code ?? null,
      planName: subscription?.plan.name ?? null,
      subscriptionStatus: subscription?.status ?? null,
      limits,
    };
  }

  private resource(key: ResourceKey, used: number, limit?: number | null): ResourceUsage {
    const lim = limit ?? null;
    const unlimited = lim === null;
    // Decisions use the RAW value; only the displayed `used` is rounded.
    const exceeded = !unlimited && used > lim;
    const percentUsed = unlimited || lim === 0 ? null : Math.round((used / lim) * 100);
    const approaching = !unlimited && !exceeded && lim > 0 && used / lim >= APPROACHING_THRESHOLD;
    return { key, used: round(used), limit: lim, unlimited, exceeded, approaching, percentUsed };
  }

  /**
   * Enforce a plan limit before adding a resource. Allows the add while within
   * limit; on first overage it starts a 7-day grace period (temporary usage
   * permitted) and only blocks once the grace period has elapsed.
   */
  async assertCanAdd(companyId: string, resource: ResourceKey, increment = 1): Promise<void> {
    const evaluation = await this.evaluate(companyId);
    const r = evaluation.resources.find((x) => x.key === resource);
    if (!r || r.limit === null) return; // unknown or unlimited
    if (r.used + increment <= r.limit) return; // fits within limit

    if (evaluation.graceExpired) {
      throw new ForbiddenException(
        `Plan limit reached for ${resource}. The grace period has ended — upgrade the plan to add more.`,
      );
    }
    if (!evaluation.gracePeriodEndsAt) {
      await this.startGracePeriod(companyId, resource, r);
    }
    // Within (or just-started) grace period: allow the add.
  }

  /** The company's plan limits (empty object if there is no subscription). */
  async getPlanLimits(companyId: string): Promise<PlanLimits> {
    const subscription = await this.getSubscription(companyId);
    return (subscription?.plan.limits ?? {}) as PlanLimits;
  }

  /** Enforce the plan's per-file maximum size (maxFileSizeMb). */
  async assertFileSize(companyId: string, fileSizeBytes: number): Promise<void> {
    const limits = await this.getPlanLimits(companyId);
    if (limits.maxFileSizeMb != null && fileSizeBytes > limits.maxFileSizeMb * 1_000_000) {
      throw new ForbiddenException(
        `File exceeds the plan's maximum file size of ${limits.maxFileSizeMb} MB.`,
      );
    }
  }

  private async startGracePeriod(
    companyId: string,
    resource: ResourceKey,
    r: ResourceUsage,
  ): Promise<void> {
    const subscription = await this.getSubscription(companyId);
    if (subscription) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { gracePeriodEndsAt: new Date(Date.now() + GRACE_PERIOD_DAYS * 86_400_000) },
      });
    }
    await this.activityLog.log({
      action: 'usage.grace_period.started',
      category: ActivityCategory.USAGE,
      companyId,
      targetType: 'company',
      targetId: companyId,
      metadata: { resource, used: r.used, limit: r.limit, graceDays: GRACE_PERIOD_DAYS },
    });
  }

  /**
   * Reconcile the grace flag with current usage: clears (and logs the end of)
   * an active grace period once usage is back within limits — e.g. after a
   * Super Admin upgrades the plan. Call after subscription/plan changes.
   */
  async reconcileGrace(companyId: string): Promise<UsageEvaluation> {
    const evaluation = await this.evaluate(companyId);
    const subscription = await this.getSubscription(companyId);
    if (!subscription?.gracePeriodEndsAt) return evaluation;

    const stillExceeded = evaluation.resources.some((r) => r.exceeded);
    if (!stillExceeded) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { gracePeriodEndsAt: null },
      });
      await this.activityLog.log({
        action: 'usage.grace_period.ended',
        category: ActivityCategory.USAGE,
        companyId,
        targetType: 'company',
        targetId: companyId,
        metadata: { reason: 'within_limits' },
      });
      // Return a fresh evaluation reflecting the cleared grace period.
      return this.evaluate(companyId);
    }
    return evaluation;
  }
}
