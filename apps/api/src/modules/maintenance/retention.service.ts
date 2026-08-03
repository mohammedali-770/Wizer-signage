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

  async run(opts: { retentionDays: number; now?: Date }): Promise<RetentionResult> {
    const now = opts.now ?? new Date();
    const cutoff = new Date(now.getTime() - opts.retentionDays * 24 * 60 * 60 * 1000);

    const failures: string[] = [];
    const truncated: string[] = [];

    // Each step is fault-isolated: one failing target must NOT abort the rest of
    // the cleanup (so e.g. a screenshot-storage hiccup can't block trash purge).
    // Failures are RECORDED, not swallowed.
    const proofOfPlay = await this.safe(failures, 'proofOfPlay', () =>
      this.purgeBatched(
        truncated,
        'proofOfPlay',
        (take) =>
          this.prisma.proofOfPlay.findMany({
            where: { startedAt: { lt: cutoff } },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.proofOfPlay.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const heartbeats = await this.safe(failures, 'heartbeats', () =>
      this.purgeBatched(
        truncated,
        'heartbeats',
        (take) =>
          this.prisma.heartbeat.findMany({
            where: { createdAt: { lt: cutoff } },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.heartbeat.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const alerts = await this.safe(failures, 'alerts', () =>
      this.purgeBatched(
        truncated,
        'alerts',
        (take) =>
          this.prisma.alert.findMany({
            where: {
              status: { in: [AlertStatus.RESOLVED, AlertStatus.DISMISSED] },
              resolvedAt: { lt: cutoff },
            },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.alert.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const emailLogs = await this.safe(failures, 'emailLogs', () =>
      this.purgeBatched(
        truncated,
        'emailLogs',
        (take) =>
          this.prisma.emailDeliveryLog.findMany({
            where: { createdAt: { lt: cutoff } },
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
    const activityLogs = await this.safe(failures, 'activityLogs', () =>
      this.purgeBatched(
        truncated,
        'activityLogs',
        (take) =>
          this.prisma.activityLog.findMany({
            where: { createdAt: { lt: cutoff } },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.activityLog.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const loginEvents = await this.safe(failures, 'loginEvents', () =>
      this.purgeBatched(
        truncated,
        'loginEvents',
        (take) =>
          this.prisma.loginEvent.findMany({
            where: { createdAt: { lt: cutoff } },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.loginEvent.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const notifications = await this.safe(failures, 'notifications', () =>
      this.purgeBatched(
        truncated,
        'notifications',
        (take) =>
          this.prisma.notification.findMany({
            where: { createdAt: { lt: cutoff } },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.notification.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const deviceCommands = await this.safe(failures, 'deviceCommands', () =>
      this.purgeBatched(
        truncated,
        'deviceCommands',
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
            },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.deviceCommand.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    // Revoked/expired sessions were only ever stamped, never removed.
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

    const screenshots = await this.safe(failures, 'screenshots', () =>
      this.purgeWithStorage(
        truncated,
        'screenshots',
        () =>
          this.prisma.screenshot.findMany({
            where: { takenAt: { lt: cutoff } },
            select: { id: true, storageKey: true },
            take: DELETE_BATCH,
          }),
        (ids) => this.prisma.screenshot.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const reportDeliveries = await this.safe(failures, 'reportDeliveries', () =>
      this.purgeWithStorage(
        truncated,
        'reportDeliveries',
        () =>
          this.prisma.scheduledReportDelivery.findMany({
            where: { createdAt: { lt: cutoff } },
            select: { id: true, fileStorageKey: true },
            take: DELETE_BATCH,
          }),
        (ids) => this.prisma.scheduledReportDelivery.deleteMany({ where: { id: { in: ids } } }),
        'fileStorageKey',
      ),
    );
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
