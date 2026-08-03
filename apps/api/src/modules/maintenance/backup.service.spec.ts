import { Logger } from '@nestjs/common';

import { BackupService } from './backup.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  let seq = 0;
  const prisma: any = {
    backupRecord: {
      create: jest.fn(({ data }: any) =>
        Promise.resolve({
          id: `b${++seq}`,
          ...data,
          startedAt: data.startedAt ?? new Date(),
          createdAt: new Date(),
        }),
      ),
      update: jest.fn(({ where, data }: any) =>
        Promise.resolve({ id: where.id, ...data, startedAt: new Date(), createdAt: new Date() }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $transaction: (ops: Promise<any>[]) => Promise.all(ops),
  };
  const alerts = {
    raise: jest.fn().mockResolvedValue({ created: true }),
    resolveByKey: jest.fn().mockResolvedValue(0),
  };
  return { service: new BackupService(prisma, alerts as any), prisma, alerts };
}

describe('BackupService', () => {
  it('records a successful run without raising an alert', async () => {
    const t = build();
    const run = await t.service.record({
      type: 'DATABASE' as any,
      status: 'SUCCESS' as any,
      location: 's3://b',
      sizeBytes: 1024,
    });
    expect(run.status).toBe('SUCCESS');
    expect(t.alerts.raise).not.toHaveBeenCalled();
  });

  it('raises a system alert when a backup is recorded as FAILED', async () => {
    const t = build();
    await t.service.record({
      type: 'DATABASE' as any,
      status: 'FAILED' as any,
      error: 'pg_dump failed',
    });
    expect(t.alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: null, type: 'backup.failed', severity: 'CRITICAL' }),
    );
  });

  it('checkRecency raises an overdue alert when no recent successful DB backup exists', async () => {
    const t = build();
    t.prisma.backupRecord.findFirst.mockResolvedValue(null); // never backed up
    const stale = await t.service.checkRecency(new Date());
    expect(stale).toBe(true);
    expect(t.alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'system:backup:database:overdue' }),
    );
  });

  it('checkRecency resolves the overdue alert when a recent backup exists', async () => {
    const t = build();
    t.prisma.backupRecord.findFirst.mockResolvedValue({ finishedAt: new Date() });
    const stale = await t.service.checkRecency(new Date());
    expect(stale).toBe(false);
    expect(t.alerts.resolveByKey).toHaveBeenCalledWith('system:backup:database:overdue');
  });
});

/**
 * Alerting is best-effort — a backup must still be recorded even if the
 * notification cannot be delivered — but it must not be SILENT. Swallowing the
 * error produced the worst state possible: backups overdue, the alert that
 * would say so failing, and no trace of either.
 */
describe('BackupService — alerting failures are non-fatal but never silent', () => {
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => errorLog.mockRestore());

  it('still records a FAILED backup when raising the alert throws', async () => {
    const t = build();
    t.alerts.raise.mockRejectedValue(new Error('notification service down'));

    const run = await t.service.record({
      type: 'DATABASE' as any,
      status: 'FAILED' as any,
      error: 'pg_dump failed',
    });

    expect(run.status).toBe('FAILED');
    expect(errorLog).toHaveBeenCalled();
    expect(String(errorLog.mock.calls[0][0])).toContain('notification service down');
  });

  it('still reports staleness when the overdue alert cannot be raised', async () => {
    const t = build();
    t.prisma.backupRecord.findFirst.mockResolvedValue(null);
    t.alerts.raise.mockRejectedValue(new Error('db down'));

    await expect(t.service.checkRecency(new Date())).resolves.toBe(true);
    expect(errorLog).toHaveBeenCalled();
  });

  it('still reports health when resolving the overdue alert fails', async () => {
    const t = build();
    t.prisma.backupRecord.findFirst.mockResolvedValue({ finishedAt: new Date() });
    t.alerts.resolveByKey.mockRejectedValue(new Error('db down'));

    await expect(t.service.checkRecency(new Date())).resolves.toBe(false);
    expect(errorLog).toHaveBeenCalled();
  });

  it('names which alerting call failed so the log is actionable', async () => {
    const t = build();
    t.prisma.backupRecord.findFirst.mockResolvedValue(null);
    t.alerts.raise.mockRejectedValue(new Error('boom'));

    await t.service.checkRecency(new Date());
    expect(String(errorLog.mock.calls[0][0])).toContain('raise database-backup-overdue');
  });
});
