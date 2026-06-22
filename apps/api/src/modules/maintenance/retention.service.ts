import { Injectable, Logger } from '@nestjs/common';
import { AlertStatus } from '@prisma/client';

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
}

const STORAGE_BATCH = 10_000;
/** Drain up to this many batches per run (bounds a huge backlog to ~100k/run). */
const MAX_BATCHES = 10;

/**
 * Data-retention cleanup (Phase 10). Deletes telemetry/operational data older
 * than the retention window (default 90 days). FINANCIAL records — invoices and
 * subscriptions — are NEVER touched. Storage objects backing deleted screenshots
 * and report files are removed best-effort. Idempotent: re-running only deletes
 * what is now past the cutoff.
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

    // Each step is fault-isolated: one failing target must NOT abort the rest of
    // the cleanup (so e.g. a screenshot-storage hiccup can't block trash purge).
    const proofOfPlay = await this.safe('proofOfPlay', () =>
      this.prisma.proofOfPlay
        .deleteMany({ where: { startedAt: { lt: cutoff } } })
        .then((r) => r.count),
    );
    const heartbeats = await this.safe('heartbeats', () =>
      this.prisma.heartbeat
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
    );
    const alerts = await this.safe('alerts', () =>
      this.prisma.alert
        .deleteMany({
          where: {
            status: { in: [AlertStatus.RESOLVED, AlertStatus.DISMISSED] },
            resolvedAt: { lt: cutoff },
          },
        })
        .then((r) => r.count),
    );
    const emailLogs = await this.safe('emailLogs', () =>
      this.prisma.emailDeliveryLog
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
    );
    const screenshots = await this.safe('screenshots', () =>
      this.purgeWithStorage(
        () =>
          this.prisma.screenshot.findMany({
            where: { takenAt: { lt: cutoff } },
            select: { id: true, storageKey: true },
            take: STORAGE_BATCH,
          }),
        (ids) => this.prisma.screenshot.deleteMany({ where: { id: { in: ids } } }),
      ),
    );
    const reportDeliveries = await this.safe('reportDeliveries', () =>
      this.purgeWithStorage(
        () =>
          this.prisma.scheduledReportDelivery.findMany({
            where: { createdAt: { lt: cutoff } },
            select: { id: true, fileStorageKey: true },
            take: STORAGE_BATCH,
          }),
        (ids) => this.prisma.scheduledReportDelivery.deleteMany({ where: { id: { in: ids } } }),
        'fileStorageKey',
      ),
    );
    const contentTrash = await this.safe('contentTrash', () =>
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
    };
    this.logger.log(`Retention cleanup: ${JSON.stringify(result)}`);
    return result;
  }

  /** Run one cleanup target; a failure is logged and counted as 0, never thrown. */
  private async safe(label: string, fn: () => Promise<number>): Promise<number> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(
        `Retention step "${label}" failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 0;
    }
  }

  /**
   * Delete rows + their backing storage objects (best-effort), looping through
   * multiple batches so a large backlog is drained over one run (bounded by
   * MAX_BATCHES). Storage is removed BEFORE the row delete so a row never
   * outlives its file by more than one run (self-healing — never an orphan file).
   */
  private async purgeWithStorage(
    find: () => Promise<
      Array<{ id: string; storageKey?: string | null; fileStorageKey?: string | null }>
    >,
    del: (ids: string[]) => Promise<{ count: number }>,
    keyField: 'storageKey' | 'fileStorageKey' = 'storageKey',
  ): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await find();
      if (rows.length === 0) break;
      for (const row of rows) {
        const key = (row as Record<string, string | null | undefined>)[keyField];
        if (key) await this.storage.remove(key).catch(() => undefined);
      }
      total += (await del(rows.map((r) => r.id))).count;
      if (rows.length < STORAGE_BATCH) break;
    }
    return total;
  }
}
