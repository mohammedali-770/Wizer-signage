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
