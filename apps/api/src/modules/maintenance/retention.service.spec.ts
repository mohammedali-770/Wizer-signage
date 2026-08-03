import { RetentionService } from './retention.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Builds a Prisma mock where every purge target is a BATCHED
 * findMany(select id) -> deleteMany(id in [...]) pair, matching the service's
 * real access pattern. `rows` controls how many eligible rows each target has;
 * the mock hands them out a page at a time exactly like Postgres would, so the
 * batching loop is genuinely exercised rather than stubbed away.
 */
function build(opts: { rows?: Record<string, number> } = {}) {
  const counts: Record<string, number> = {
    proofOfPlay: 5,
    heartbeat: 10,
    alert: 2,
    emailDeliveryLog: 3,
    activityLog: 7,
    loginEvent: 6,
    notification: 4,
    deviceCommand: 8,
    session: 9,
    passwordResetToken: 1,
    twoFactorChallenge: 1,
    pairingCode: 1,
    ...(opts.rows ?? {}),
  };

  /** Remaining eligible rows per delegate, decremented as batches are deleted. */
  const remaining: Record<string, number> = { ...counts };
  const lastWhere: Record<string, any> = {};

  const batched = (key: string) => ({
    findMany: jest.fn(({ where, take }: any) => {
      lastWhere[key] = where;
      const n = Math.min(remaining[key] ?? 0, take ?? 10_000);
      return Promise.resolve(Array.from({ length: n }, (_, i) => ({ id: `${key}-${i}` })));
    }),
    deleteMany: jest.fn(({ where }: any) => {
      const n = where?.id?.in?.length ?? 0;
      remaining[key] = Math.max(0, (remaining[key] ?? 0) - n);
      return Promise.resolve({ count: n });
    }),
  });

  const prisma: any = {
    proofOfPlay: batched('proofOfPlay'),
    heartbeat: batched('heartbeat'),
    alert: batched('alert'),
    emailDeliveryLog: batched('emailDeliveryLog'),
    activityLog: batched('activityLog'),
    loginEvent: batched('loginEvent'),
    notification: batched('notification'),
    deviceCommand: batched('deviceCommand'),
    session: batched('session'),
    passwordResetToken: batched('passwordResetToken'),
    twoFactorChallenge: batched('twoFactorChallenge'),
    pairingCode: batched('pairingCode'),
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
  return { service, prisma, storage, contentCleanup, lastWhere, remaining };
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
    const cutoff = t.lastWhere.proofOfPlay.startedAt.lt as Date;
    expect(cutoff.getTime()).toBe(new Date('2026-06-17T00:00:00Z').getTime() - 90 * 86400_000);
  });

  it('only deletes resolved/dismissed alerts (open alerts are kept regardless of age)', async () => {
    const t = build();
    await t.service.run({ retentionDays: 90, now: new Date() });
    expect(t.lastWhere.alert.status.in).toEqual(['RESOLVED', 'DISMISSED']);
  });

  it('removes storage objects for purged screenshots + report files', async () => {
    const t = build();
    await t.service.run({ retentionDays: 90, now: new Date() });
    expect(t.storage.remove).toHaveBeenCalledWith('k1');
    expect(t.storage.remove).toHaveBeenCalledWith('rk1');
  });

  it('isolates a failing step — one target throwing does not abort the rest', async () => {
    const t = build();
    t.prisma.proofOfPlay.findMany.mockRejectedValue(new Error('db blip'));
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

/**
 * Batching + failure surfacing.
 *
 * A single unbounded deleteMany over a telemetry table is what fills the disk:
 * at scale the statement exceeds the pooler's timeout, fails every night, and —
 * when the failure is swallowed and reported as 0 — is indistinguishable from
 * "nothing to delete". These tests pin both halves of the fix.
 */
describe('RetentionService batching + failure surfacing', () => {
  it('never issues an unbounded delete — every delete is bounded by a page of ids', async () => {
    const t = build({ rows: { heartbeat: 25_000 } });
    await t.service.run({ retentionDays: 90, now: new Date() });

    for (const call of t.prisma.heartbeat.deleteMany.mock.calls) {
      // The predicate must be an explicit id list, never a bare range scan.
      expect(Array.isArray(call[0].where.id.in)).toBe(true);
      expect(call[0].where.id.in.length).toBeLessThanOrEqual(10_000);
    }
    // findMany must always cap the page size.
    for (const call of t.prisma.heartbeat.findMany.mock.calls) {
      expect(call[0].take).toBeLessThanOrEqual(10_000);
    }
  });

  it('drains a multi-page backlog across several batches', async () => {
    const t = build({ rows: { heartbeat: 25_000 } });
    const res = await t.service.run({ retentionDays: 90, now: new Date() });
    expect(res.heartbeats).toBe(25_000);
    expect(t.prisma.heartbeat.deleteMany).toHaveBeenCalledTimes(3); // 10k + 10k + 5k
    expect(res.truncated).not.toContain('heartbeats');
  });

  it('stops at the per-run cap and reports truncation instead of claiming success', async () => {
    // 10 batches x 10k = 100k is the cap; 150k cannot finish in one run.
    const t = build({ rows: { heartbeat: 150_000 } });
    const res = await t.service.run({ retentionDays: 90, now: new Date() });
    expect(res.heartbeats).toBe(100_000);
    expect(res.truncated).toContain('heartbeats'); // a cap is never silent
  });

  it('records a failed step in `failures` rather than silently reporting 0', async () => {
    const t = build();
    t.prisma.heartbeat.findMany.mockRejectedValue(new Error('statement timeout'));
    const res = await t.service.run({ retentionDays: 90, now: new Date() });

    expect(res.heartbeats).toBe(0);
    // The whole point: 0-with-a-failure must be distinguishable from 0-because-empty.
    expect(res.failures.some((f) => f.includes('heartbeats'))).toBe(true);
    expect(res.failures.some((f) => f.includes('statement timeout'))).toBe(true);
  });

  it('reports no failures on a clean run', async () => {
    const t = build();
    const res = await t.service.run({ retentionDays: 90, now: new Date() });
    expect(res.failures).toEqual([]);
    expect(res.truncated).toEqual([]);
  });
});

/**
 * Previously unpruned tables. `login_events` and `pairing_codes` are written by
 * UNAUTHENTICATED endpoints, so with no retention path an attacker could consume
 * tenant-billed storage indefinitely with credential-stuffing or pairing spam.
 */
describe('RetentionService newly pruned tables', () => {
  it('purges the previously unbounded high-volume tables', async () => {
    const t = build();
    const res = await t.service.run({ retentionDays: 90, now: new Date() });
    expect(res).toMatchObject({
      activityLogs: 7,
      loginEvents: 6,
      notifications: 4,
      deviceCommands: 8,
      sessions: 9,
      authTokens: 3, // reset tokens + 2FA challenges + pairing codes
    });
  });

  it('keeps device commands that a currently-offline screen could still act on', async () => {
    const t = build();
    await t.service.run({ retentionDays: 90, now: new Date() });
    // Only terminal states are eligible; PENDING/DELIVERED/RUNNING are retained.
    expect(t.lastWhere.deviceCommand.status.in).toEqual([
      'SUCCEEDED',
      'FAILED',
      'EXPIRED',
      'CANCELLED',
    ]);
  });

  it('purges only sessions that are revoked or expired past the cutoff', async () => {
    const t = build();
    const now = new Date('2026-06-17T00:00:00Z');
    await t.service.run({ retentionDays: 90, now });
    const cutoff = new Date(now.getTime() - 90 * 86400_000);
    expect(t.lastWhere.session.OR).toEqual([
      { revokedAt: { lt: cutoff } },
      { expiresAt: { lt: cutoff } },
    ]);
  });

  it('purges expired single-use auth material (reset, 2FA, pairing)', async () => {
    const t = build();
    const now = new Date('2026-06-17T00:00:00Z');
    await t.service.run({ retentionDays: 90, now });
    const cutoff = new Date(now.getTime() - 90 * 86400_000);
    expect(t.lastWhere.passwordResetToken.expiresAt.lt).toEqual(cutoff);
    expect(t.lastWhere.twoFactorChallenge.expiresAt.lt).toEqual(cutoff);
    expect(t.lastWhere.pairingCode.expiresAt.lt).toEqual(cutoff);
  });
});
