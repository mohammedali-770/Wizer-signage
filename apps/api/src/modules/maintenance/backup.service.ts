import { Injectable } from '@nestjs/common';
import { BackupStatus, BackupType, NotificationSeverity, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AlertService } from '../notifications/alert.service';
import { AlertEvent } from '../notifications/notifications.constants';

export interface RecordBackupInput {
  type: BackupType;
  status: BackupStatus;
  location?: string;
  sizeBytes?: number;
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
  metadata?: Record<string, unknown>;
}

const DEFAULT_STALE_DAYS = 2;

/**
 * Backup status + health (Phase 10). The actual `pg_dump` runs in a script
 * (scripts/backup-db.sh); the script records the run here via the maintenance
 * CLI. A FAILED record raises a system (companyId-null) alert for Super Admins,
 * as does a database backup not having succeeded recently.
 */
@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertService,
  ) {}

  /** Record a completed/failed run in one call (used by the backup script CLI). */
  async record(input: RecordBackupInput) {
    const run = await this.prisma.backupRecord.create({
      data: {
        type: input.type,
        status: input.status,
        location: input.location ?? null,
        sizeBytes: input.sizeBytes !== undefined ? BigInt(Math.round(input.sizeBytes)) : null,
        error: input.error ?? null,
        startedAt: input.startedAt ?? new Date(),
        finishedAt: input.finishedAt ?? (input.status === BackupStatus.RUNNING ? null : new Date()),
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    if (input.status === BackupStatus.FAILED)
      await this.raiseFailedAlert(input.type, input.error ?? 'Backup failed.');
    return this.toView(run);
  }

  /** Mark the start of a run (status RUNNING). */
  async start(type: BackupType) {
    const run = await this.prisma.backupRecord.create({
      data: { type, status: BackupStatus.RUNNING, startedAt: new Date() },
    });
    return this.toView(run);
  }

  async complete(id: string, data: { location?: string; sizeBytes?: number }) {
    const run = await this.prisma.backupRecord.update({
      where: { id },
      data: {
        status: BackupStatus.SUCCESS,
        location: data.location ?? null,
        sizeBytes: data.sizeBytes !== undefined ? BigInt(Math.round(data.sizeBytes)) : null,
        finishedAt: new Date(),
      },
    });
    return this.toView(run);
  }

  async fail(id: string, error: string) {
    const run = await this.prisma.backupRecord.update({
      where: { id },
      data: { status: BackupStatus.FAILED, error, finishedAt: new Date() },
    });
    await this.raiseFailedAlert(run.type, error);
    return this.toView(run);
  }

  /** Super Admin view: last run per type + recent history + staleness. */
  async status(now: Date = new Date(), staleDays = DEFAULT_STALE_DAYS) {
    const [recent, lastDbSuccess] = await this.prisma.$transaction([
      this.prisma.backupRecord.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
      this.prisma.backupRecord.findFirst({
        where: { type: BackupType.DATABASE, status: BackupStatus.SUCCESS },
        orderBy: { finishedAt: 'desc' },
      }),
    ]);
    const lastSuccessfulAt = lastDbSuccess?.finishedAt ?? null;
    const stale =
      !lastSuccessfulAt ||
      lastSuccessfulAt.getTime() < now.getTime() - staleDays * 24 * 60 * 60 * 1000;
    return {
      lastSuccessfulDatabaseBackupAt: lastSuccessfulAt ? lastSuccessfulAt.toISOString() : null,
      stale,
      staleThresholdDays: staleDays,
      recent: recent.map((r) => this.toView(r)),
    };
  }

  /** Raise an alert if the database has not had a successful backup recently. */
  async checkRecency(now: Date = new Date(), staleDays = DEFAULT_STALE_DAYS): Promise<boolean> {
    const { stale, lastSuccessfulDatabaseBackupAt } = await this.status(now, staleDays);
    if (stale) {
      await this.alerts
        .raise({
          companyId: null,
          type: AlertEvent.BackupFailed,
          severity: NotificationSeverity.CRITICAL,
          title: 'Database backup overdue',
          message: lastSuccessfulDatabaseBackupAt
            ? `Last successful database backup was ${lastSuccessfulDatabaseBackupAt}.`
            : 'No successful database backup has been recorded.',
          dedupeKey: 'system:backup:database:overdue',
        })
        .catch(() => undefined);
    } else {
      await this.alerts.resolveByKey('system:backup:database:overdue').catch(() => undefined);
    }
    return stale;
  }

  private async raiseFailedAlert(type: BackupType, error: string) {
    await this.alerts
      .raise({
        companyId: null,
        type: AlertEvent.BackupFailed,
        severity: NotificationSeverity.CRITICAL,
        title: `${type} backup failed`,
        message: error,
        dedupeKey: `system:backup:${type.toLowerCase()}:failed`,
      })
      .catch(() => undefined);
  }

  private toView(r: Prisma.BackupRecordGetPayload<true>) {
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      location: r.location,
      sizeBytes: r.sizeBytes != null ? r.sizeBytes.toString() : null,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
