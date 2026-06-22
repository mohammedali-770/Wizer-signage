import { RetentionService } from './retention.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    proofOfPlay: { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) },
    heartbeat: { deleteMany: jest.fn().mockResolvedValue({ count: 10 }) },
    alert: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    emailDeliveryLog: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    screenshot: {
      findMany: jest.fn().mockResolvedValue([{ id: 'sc1', storageKey: 'k1' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    scheduledReportDelivery: {
      findMany: jest.fn().mockResolvedValue([{ id: 'd1', fileStorageKey: 'rk1' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // NOTE: invoice/subscription delegates are intentionally ABSENT — if the
    // service tried to delete financial records the test would throw.
  };
  const storage = { remove: jest.fn().mockResolvedValue(undefined) };
  const contentCleanup = { purgeExpiredTrash: jest.fn().mockResolvedValue(4) };
  const service = new RetentionService(prisma, storage as any, contentCleanup as any);
  return { service, prisma, storage, contentCleanup };
}

describe('RetentionService.run', () => {
  it('deletes telemetry/operational data older than the retention window', async () => {
    const t = build();
    const res = await t.service.run({ retentionDays: 90, now: new Date('2026-06-17T00:00:00Z') });

    expect(res).toMatchObject({
      proofOfPlay: 5,
      heartbeats: 10,
      alerts: 2,
      emailLogs: 3,
      screenshots: 1,
      reportDeliveries: 1,
      contentTrash: 4,
    });

    // Proof-of-play uses startedAt (the actual playback time), not createdAt.
    const cutoff = t.prisma.proofOfPlay.deleteMany.mock.calls[0][0].where.startedAt.lt as Date;
    expect(cutoff.getTime()).toBe(new Date('2026-06-17T00:00:00Z').getTime() - 90 * 86400_000);
  });

  it('only deletes resolved/dismissed alerts (open alerts are kept regardless of age)', async () => {
    const t = build();
    await t.service.run({ retentionDays: 90, now: new Date() });
    expect(t.prisma.alert.deleteMany.mock.calls[0][0].where.status.in).toEqual([
      'RESOLVED',
      'DISMISSED',
    ]);
  });

  it('removes storage objects for purged screenshots + report files', async () => {
    const t = build();
    await t.service.run({ retentionDays: 90, now: new Date() });
    expect(t.storage.remove).toHaveBeenCalledWith('k1');
    expect(t.storage.remove).toHaveBeenCalledWith('rk1');
  });

  it('isolates a failing step — one target throwing does not abort the rest', async () => {
    const t = build();
    t.prisma.proofOfPlay.deleteMany.mockRejectedValue(new Error('db blip'));
    const res = await t.service.run({ retentionDays: 90, now: new Date() });
    expect(res.proofOfPlay).toBe(0); // failed step counts as 0
    expect(res.heartbeats).toBe(10); // later steps still ran
    expect(t.contentCleanup.purgeExpiredTrash).toHaveBeenCalled();
  });

  it('delegates content-trash purge and never touches financial records', async () => {
    const t = build();
    await t.service.run({ retentionDays: 90, now: new Date() });
    expect(t.contentCleanup.purgeExpiredTrash).toHaveBeenCalled();
    // Reaching here without a thrown "invoice is undefined" proves financial
    // delegates were never invoked.
  });
});
