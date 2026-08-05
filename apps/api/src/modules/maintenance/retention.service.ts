import { Injectable, Logger } from '@nestjs/common';
import { AlertStatus, DeviceCommandStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ContentCleanupService } from '../content/content-cleanup.service';
import { StorageService } from '../storage/storage.service';

export interface RetentionResult {
  retentionDays: number;
  proofOfPlay: number;
  heartbeats: number;
  screenshots: number;
  alerts: number;
  emailLogs: number;
  reportDeliveries: number;
  contentTrash: number;
  activityLogs: number;
  loginEvents: number;
  notifications: number;
  deviceCommands: number;
  sessions: number;
  authTokens: number;
  /**
   * Steps that ERRORED this run. A failure here is not cosmetic: if deletion
   * keeps failing the database grows without bound until writes stop, so the
   * caller must surface this (the CLI exits non-zero) instead of it reading as
   * "nothing to delete".
   */
  failures: string[];
  /**
   * Steps that hit MAX_BATCHES with rows still pending. The backlog is being
   * drained but is bigger than one run — never report that as "done".
   */
  truncated: string[];
}

/** Rows deleted per statement. Small enough to stay well inside a pooled
 *  statement timeout, large enough to drain a real backlog. */
const DELETE_BATCH = 10_000;

/** Per-window totals from one pass of the tenant-scoped purges. */
interface TenantPurgeCounts {
  proofOfPlay: number;
  heartbeats: number;
  alerts: number;
  emailLogs: number;
  activityLogs: number;
  loginEvents: number;
  notifications: number;
  deviceCommands: number;
  screenshots: number;
  reportDeliveries: number;
}

/**
 * Upper bound on a plan's `dataRetentionDays`. A typo in the plan editor (an
 * extra zero) would otherwise exempt a tenant from pruning more or less forever,
 * and the failure mode of that is the disk filling and ALL writes failing
 * platform-wide — the exact outcome retention exists to prevent.
 */
const MAX_PLAN_RETENTION_DAYS = 3650; // 10 years
/** Drain up to this many batches per target per run (bounds one run's work). */
const MAX_BATCHES = 10;

/**
 * Data-retention cleanup (Phase 10). Deletes telemetry/operational data older
 * than the retention window (default 90 days). FINANCIAL records — invoices and
 * subscriptions — are NEVER touched. Storage objects backing deleted screenshots
 * and report files are removed best-effort. Idempotent: re-running only deletes
 * what is now past the cutoff.
 *
 * EVERY delete is BATCHED. A single unbounded `deleteMany` over a telemetry
 * table is the failure that ends with the database full: at a 60s heartbeat
 * interval 1,000 screens produce ~1.44M rows/day, and one statement covering
 * that cohort exceeds the pooler's statement timeout. The delete then fails
 * every night — silently, if failures are swallowed — until writes stop
 * platform-wide. Batching keeps each statement small; `failures` makes a
 * persistent problem loud.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly contentCleanup: ContentCleanupService,
  ) {}

  /**
   * Companies whose plan promises MORE retention than the global window.
   *
   * `dataRetentionDays` is sold in the plan editor and rendered on the company
   * page, but until now nothing read it: the job took one global number, so a
   * tenant paying for a 365-day window had its telemetry deleted at 90 like
   * everyone else. This resolves the promise into companies grouped BY window,
   * so each group can be swept at its own cutoff.
   *
   * Deliberately ONE-DIRECTIONAL — a plan can only EXTEND retention past the
   * global floor, never shorten it. Honouring a shorter plan value would mean
   * this change starts deleting data that is being kept today, and how long a
   * customer's records are held is a contractual and (in several markets) legal
   * question, not something an infrastructure change should decide silently.
   * Over-retention costs disk; under-retention destroys evidence.
   */
  private async retentionWindows(defaultDays: number): Promise<Map<number, string[]>> {
    const subscriptions = await this.prisma.subscription.findMany({
      select: { companyId: true, plan: { select: { limits: true } } },
    });

    const windows = new Map<number, string[]>();
    for (const sub of subscriptions) {
      const raw = (sub.plan?.limits as { dataRetentionDays?: number | null } | null)
        ?.dataRetentionDays;
      // `limits` is untyped JSON. Anything that is not a finite number falls
      // back to the global window: treating a malformed value as "retain
      // forever" is how a table grows until the disk fills.
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const days = Math.trunc(raw);
      if (days <= defaultDays) continue;
      if (days > MAX_PLAN_RETENTION_DAYS) {
        // Almost certainly a plan-editor typo (an extra zero). Sweeping at the
        // global window is the conservative read: the alternative is a tenant
        // that is never pruned, and the failure mode of THAT is the disk
        // filling and every write failing platform-wide. Logged so it is
        // fixable rather than silent.
        this.logger.warn(
          `Plan limit dataRetentionDays=${days} exceeds the ${MAX_PLAN_RETENTION_DAYS}-day ` +
            `maximum and was ignored; that company is being pruned at the global window.`,
        );
        continue;
      }
      const group = windows.get(days);
      if (group) group.push(sub.companyId);
      else windows.set(days, [sub.companyId]);
    }
    return windows;
  }

  /**
   * Every purge whose table carries a `companyId`, run against ONE window.
   *
   * Extracted so the whole set can run once per distinct retention window
   * instead of once globally. `scope` is the tenant predicate for this pass
   * (`notIn` the extended companies for the global pass, `in` a window's
   * companies otherwise) and `label` distinguishes the pass in `failures` /
   * `truncated`, so a cap hit on the 365-day pass is not reported as a cap hit
   * on the global one.
   */
  private async purgeTenantScoped(
    cutoff: Date,
    tenantScoped: Record<string, unknown>,
    failures: string[],
    truncated: string[],
    label: string,
  ): Promise<TenantPurgeCounts> {
    const proofOfPlay = await this.safe(failures, `proofOfPlay${label}`, () =>
      this.purgeBatched(
        truncated,
        `proofOfPlay${label}`,
        (take) =>
          this.prisma.proofOfPlay.findMany({
            where: { startedAt: { lt: cutoff }, ...tenantScoped },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.proofOfPlay.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const heartbeats = await this.safe(failures, `heartbeats${label}`, () =>
      this.purgeBatched(
        truncated,
        `heartbeats${label}`,
        (take) =>
          this.prisma.heartbeat.findMany({
            where: { createdAt: { lt: cutoff }, ...tenantScoped },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.heartbeat.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const alerts = await this.safe(failures, `alerts${label}`, () =>
      this.purgeBatched(
        truncated,
        `alerts${label}`,
        (take) =>
          this.prisma.alert.findMany({
            where: {
              status: { in: [AlertStatus.RESOLVED, AlertStatus.DISMISSED] },
              resolvedAt: { lt: cutoff },
              ...tenantScoped,
            },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.alert.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const emailLogs = await this.safe(failures, `emailLogs${label}`, () =>
      this.purgeBatched(
        truncated,
        `emailLogs${label}`,
        (take) =>
          this.prisma.emailDeliveryLog.findMany({
            where: { createdAt: { lt: cutoff }, ...tenantScoped },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.emailDeliveryLog.deleteMany({ where: { id: { in: ids } } }),
      ),
    );

    // --- Previously unpruned high-volume tables ------------------------------
    // These had NO retention path at all. `login_events` and `pairing_codes` are
    // written by UNAUTHENTICATED endpoints, so without pruning an attacker could
    // permanently consume tenant-billed storage with credential-stuffing or
    // pairing spam. `device_commands` gets one row per active screen per content
    // mutation, so it grows as screens x edits.
    const activityLogs = await this.safe(failures, `activityLogs${label}`, () =>
      this.purgeBatched(
        truncated,
        `activityLogs${label}`,
        (take) =>
          this.prisma.activityLog.findMany({
            where: { createdAt: { lt: cutoff }, ...tenantScoped },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.activityLog.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const loginEvents = await this.safe(failures, `loginEvents${label}`, () =>
      this.purgeBatched(
        truncated,
        `loginEvents${label}`,
        (take) =>
          this.prisma.loginEvent.findMany({
            where: { createdAt: { lt: cutoff }, ...tenantScoped },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.loginEvent.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const notifications = await this.safe(failures, `notifications${label}`, () =>
      this.purgeBatched(
        truncated,
        `notifications${label}`,
        (take) =>
          this.prisma.notification.findMany({
            where: { createdAt: { lt: cutoff }, ...tenantScoped },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.notification.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const deviceCommands = await this.safe(failures, `deviceCommands${label}`, () =>
      this.purgeBatched(
        truncated,
        `deviceCommands${label}`,
        (take) =>
          this.prisma.deviceCommand.findMany({
            // Terminal states only — a PENDING/DELIVERED/RUNNING command may
            // still be actionable by a screen that has been offline.
            where: {
              status: {
                in: [
                  DeviceCommandStatus.SUCCEEDED,
                  DeviceCommandStatus.FAILED,
                  DeviceCommandStatus.EXPIRED,
                  DeviceCommandStatus.CANCELLED,
                ],
              },
              createdAt: { lt: cutoff },
              ...tenantScoped,
            },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.deviceCommand.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const screenshots = await this.safe(failures, `screenshots${label}`, () =>
      this.purgeWithStorage(
        truncated,
        `screenshots${label}`,
        () =>
          this.prisma.screenshot.findMany({
            where: { takenAt: { lt: cutoff }, ...tenantScoped },
            select: { id: true, storageKey: true },
            take: DELETE_BATCH,
          }),
        (ids) => this.prisma.screenshot.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const reportDeliveries = await this.safe(failures, `reportDeliveries${label}`, () =>
      this.purgeWithStorage(
        truncated,
        `reportDeliveries${label}`,
        () =>
          this.prisma.scheduledReportDelivery.findMany({
            where: { createdAt: { lt: cutoff }, ...tenantScoped },
            select: { id: true, fileStorageKey: true },
            take: DELETE_BATCH,
          }),
        (ids) => this.prisma.scheduledReportDelivery.deleteMany({ where: { id: { in: ids } } }),
        'fileStorageKey',
      ),
    );

    return {
      proofOfPlay,
      heartbeats,
      alerts,
      emailLogs,
      activityLogs,
      loginEvents,
      notifications,
      deviceCommands,
      screenshots,
      reportDeliveries,
    };
  }

  async run(opts: { retentionDays: number; now?: Date }): Promise<RetentionResult> {
    const now = opts.now ?? new Date();
    const cutoff = new Date(now.getTime() - opts.retentionDays * 24 * 60 * 60 * 1000);

    const failures: string[] = [];
    const truncated: string[] = [];

    // Resolved inside `safe` so a failure here cannot abort the whole cleanup —
    // an unreadable subscription table must not stop the disk from being freed.
    // On failure the map is EMPTY, which falls back to the pre-existing global
    // behaviour rather than to skipping every company.
    let windows = new Map<number, string[]>();
    await this.safe(failures, 'retentionWindows', async () => {
      windows = await this.retentionWindows(opts.retentionDays);
      return windows.size;
    });
    if (windows.size > 0) {
      this.logger.log(
        `Retention: ${[...windows.entries()].map(([d, c]) => `${c.length}@${d}d`).join(', ')} ` +
          `on a longer window than the ${opts.retentionDays}-day global setting.`,
      );
    }

    // Each step is fault-isolated: one failing target must NOT abort the rest of
    // the cleanup (so e.g. a screenshot-storage hiccup can't block trash purge).
    // Failures are RECORDED, not swallowed.
    // One pass per distinct retention window.
    //
    // The global pass EXCLUDES every company with a longer promise; each
    // extended window then gets its own pass with its own, older cutoff. This
    // is what makes the exemption a DEFERRAL rather than a permanent reprieve:
    // the global cutoff never moves, so a company merely excluded from the
    // sweep would keep its telemetry forever — unbounded growth on exactly the
    // largest tenants, which is the outcome retention exists to prevent.
    const allExtended = [...windows.values()].flat();
    const passes: Array<{ days: number; scope: Record<string, unknown>; label: string }> = [
      {
        days: opts.retentionDays,
        // Prisma renders `notIn: []` as a no-op, but omitting the key entirely
        // keeps the single-tenant/no-plan case byte-identical to the old query.
        scope: allExtended.length > 0 ? { companyId: { notIn: allExtended } } : {},
        label: '',
      },
      ...[...windows.entries()].map(([days, companyIds]) => ({
        days,
        scope: { companyId: { in: companyIds } },
        label: `@${days}d`,
      })),
    ];

    const totals: TenantPurgeCounts = {
      proofOfPlay: 0,
      heartbeats: 0,
      alerts: 0,
      emailLogs: 0,
      activityLogs: 0,
      loginEvents: 0,
      notifications: 0,
      deviceCommands: 0,
      screenshots: 0,
      reportDeliveries: 0,
    };
    for (const pass of passes) {
      const counts = await this.purgeTenantScoped(
        new Date(now.getTime() - pass.days * 24 * 60 * 60 * 1000),
        pass.scope,
        failures,
        truncated,
        pass.label,
      );
      for (const key of Object.keys(totals) as Array<keyof TenantPurgeCounts>) {
        totals[key] += counts[key];
      }
    }
    const {
      proofOfPlay,
      heartbeats,
      alerts,
      emailLogs,
      activityLogs,
      loginEvents,
      notifications,
      deviceCommands,
      screenshots,
      reportDeliveries,
    } = totals;

    // Revoked/expired sessions were only ever stamped, never removed.
    //
    // NOT tenant-scoped, unlike the telemetry above. A session row is dead auth
    // material, not a business record: it is already revoked or expired, and no
    // plan sells "we keep your dead session rows for a year". Exempting a
    // company here would grow the table for no one's benefit. The same reasoning
    // covers the single-use auth tokens below.
    const sessions = await this.safe(failures, 'sessions', () =>
      this.purgeBatched(
        truncated,
        'sessions',
        (take) =>
          this.prisma.session.findMany({
            where: {
              OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
            },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.session.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    // Consumed/expired single-use auth material. All are short-lived (minutes to
    // an hour), so anything past the retention cutoff is long dead.
    const authTokens = await this.safe(failures, 'authTokens', async () => {
      const resetTokens = await this.purgeBatched(
        truncated,
        'passwordResetTokens',
        (take) =>
          this.prisma.passwordResetToken.findMany({
            where: { expiresAt: { lt: cutoff } },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.passwordResetToken.deleteMany({ where: { id: { in: ids } } }),
      );
      const challenges = await this.purgeBatched(
        truncated,
        'twoFactorChallenges',
        (take) =>
          this.prisma.twoFactorChallenge.findMany({
            where: { expiresAt: { lt: cutoff } },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.twoFactorChallenge.deleteMany({ where: { id: { in: ids } } }),
      );
      const pairingCodes = await this.purgeBatched(
        truncated,
        'pairingCodes',
        (take) =>
          this.prisma.pairingCode.findMany({
            where: { expiresAt: { lt: cutoff } },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.pairingCode.deleteMany({ where: { id: { in: ids } } }),
      );
      return resetTokens + challenges + pairingCodes;
    });

    const contentTrash = await this.safe(failures, 'contentTrash', () =>
      this.contentCleanup.purgeExpiredTrash(),
    );

    const result: RetentionResult = {
      retentionDays: opts.retentionDays,
      proofOfPlay,
      heartbeats,
      screenshots,
      alerts,
      emailLogs,
      reportDeliveries,
      contentTrash,
      activityLogs,
      loginEvents,
      notifications,
      deviceCommands,
      sessions,
      authTokens,
      failures,
      truncated,
    };

    this.logger.log(`Retention cleanup: ${JSON.stringify(result)}`);
    if (truncated.length > 0) {
      // Never let a partial drain read as success — the backlog is still growing
      // if this repeats, which is the early warning before the disk fills.
      this.logger.warn(
        `Retention hit the per-run batch cap for: ${truncated.join(', ')}. ` +
          `Rows remain past the cutoff; consider a larger window or more frequent runs.`,
      );
    }
    if (failures.length > 0) {
      this.logger.error(
        `Retention steps FAILED: ${failures.join(' | ')}. ` +
          `Data is NOT being pruned — investigate before storage fills.`,
      );
    }
    return result;
  }

  /**
   * Run one cleanup target. A failure is logged AND recorded so the caller can
   * exit non-zero / alert — previously it was swallowed and returned 0, which is
   * indistinguishable in the result log from "nothing to delete", so a retention
   * job that had been broken for months looked healthy every single night.
   */
  private async safe(
    failures: string[],
    label: string,
    fn: () => Promise<number>,
  ): Promise<number> {
    try {
      return await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Retention step "${label}" failed: ${message}`);
      failures.push(`${label}: ${message}`);
      return 0;
    }
  }

  /**
   * Delete rows in bounded batches (the Prisma equivalent of
   * `DELETE ... WHERE id IN (SELECT id ... LIMIT n)`), looping until the target
   * is drained or MAX_BATCHES is reached. Records the label in `truncated` when
   * it stops early with rows still pending, so a cap is never silent.
   */
  private async purgeBatched(
    truncated: string[],
    label: string,
    findIds: (take: number) => Promise<Array<{ id: string }>>,
    del: (ids: string[]) => Promise<{ count: number }>,
  ): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await findIds(DELETE_BATCH);
      if (rows.length === 0) return total;
      total += (await del(rows.map((r) => r.id))).count;
      // A short page means we reached the end of the eligible rows.
      if (rows.length < DELETE_BATCH) return total;
    }
    truncated.push(label);
    return total;
  }

  /**
   * Delete rows + their backing storage objects (best-effort), looping through
   * multiple batches so a large backlog is drained over one run (bounded by
   * MAX_BATCHES). Storage is removed BEFORE the row delete so a row never
   * outlives its file by more than one run (self-healing — never an orphan file).
   */
  private async purgeWithStorage(
    truncated: string[],
    label: string,
    find: () => Promise<
      Array<{ id: string; storageKey?: string | null; fileStorageKey?: string | null }>
    >,
    del: (ids: string[]) => Promise<{ count: number }>,
    keyField: 'storageKey' | 'fileStorageKey' = 'storageKey',
  ): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await find();
      if (rows.length === 0) return total;
      for (const row of rows) {
        const key = (row as Record<string, string | null | undefined>)[keyField];
        if (key) await this.storage.remove(key).catch(() => undefined);
      }
      total += (await del(rows.map((r) => r.id))).count;
      if (rows.length < DELETE_BATCH) return total;
    }
    truncated.push(label);
    return total;
  }
}
