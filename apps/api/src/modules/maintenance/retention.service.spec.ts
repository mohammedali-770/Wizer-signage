import { RetentionService } from './retention.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Builds a Prisma mock where every purge target is a BATCHED
 * findMany(select id) -> deleteMany(id in [...]) pair, matching the service's
 * real access pattern. `rows` controls how many eligible rows each target has;
 * the mock hands them out a page at a time exactly like Postgres would, so the
 * batching loop is genuinely exercised rather than stubbed away.
 */
function build(
  opts: {
    rows?: Record<string, number>;
    /** Rows the subscription table returns, shaped as the service selects them. */
    subscriptions?: Array<{ companyId: string; plan: { limits: unknown } | null }>;
  } = {},
) {
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
  /** EVERY where-clause per delegate, in call order. Retention now runs the
   *  tenant-scoped purges once per retention window, so the last call is the
   *  last window's — not the global sweep's. */
  const allWheres: Record<string, any[]> = {};

  const batched = (key: string) => ({
    findMany: jest.fn(({ where, take }: any) => {
      lastWhere[key] = where;
      (allWheres[key] ??= []).push(where);
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
      findMany: jest.fn(({ where }: any) => {
        lastWhere.screenshot = where;
        (allWheres.screenshot ??= []).push(where);
        return Promise.resolve([{ id: 'sc1', storageKey: 'k1' }]);
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    scheduledReportDelivery: {
      findMany: jest.fn(({ where }: any) => {
        lastWhere.scheduledReportDelivery = where;
        (allWheres.scheduledReportDelivery ??= []).push(where);
        return Promise.resolve([{ id: 'd1', fileStorageKey: 'rk1' }]);
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // Retention consults plan limits to honour a longer per-company window, so
    // it must READ subscriptions. Only `findMany` is provided: `delete` /
    // `deleteMany` stay ABSENT, so an attempt to prune financial records still
    // throws exactly as it did before this delegate existed. The invoice
    // delegate remains absent entirely.
    subscription: {
      findMany: jest.fn().mockResolvedValue(opts.subscriptions ?? []),
    },
  };
  const storage = { remove: jest.fn().mockResolvedValue(undefined) };
  const contentCleanup = { purgeExpiredTrash: jest.fn().mockResolvedValue(4) };
  const service = new RetentionService(prisma, storage as any, contentCleanup as any);
  return { service, prisma, storage, contentCleanup, lastWhere, allWheres, remaining };
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

/**
 * Per-company retention windows.
 *
 * `dataRetentionDays` is sold in the plan editor and rendered on the company
 * page, but nothing read it — the job took one global number, so a tenant
 * paying for a 365-day window had its telemetry deleted at 90 like everyone
 * else.
 *
 * The fix runs the tenant-scoped purges ONCE PER WINDOW: a global pass that
 * excludes the companies with a longer promise, then one pass per extended
 * window at its own cutoff. Excluding without the second pass would be worse
 * than the bug — the global cutoff never moves, so those tenants would never be
 * pruned at all.
 */
describe('RetentionService — per-company retention windows', () => {
  const GLOBAL_DAYS = 90;
  const DAY = 86_400_000;
  const NOW = new Date('2026-06-17T00:00:00Z');

  const sub = (companyId: string, dataRetentionDays: unknown) => ({
    companyId,
    plan: { limits: { dataRetentionDays } },
  });

  /** Every tenant predicate applied to a target, in pass order. */
  const scopes = (t: ReturnType<typeof build>, target: string) =>
    (t.allWheres[target] ?? []).map((w: any) => w.companyId);

  const run = (t: ReturnType<typeof build>) =>
    t.service.run({ retentionDays: GLOBAL_DAYS, now: NOW });

  it('excludes a company with a longer promise from the global sweep', async () => {
    const t = build({ subscriptions: [sub('premium-co', 365)] });
    await run(t);
    expect(scopes(t, 'proofOfPlay')[0]).toEqual({ notIn: ['premium-co'] });
  });

  it('still sweeps that company, at ITS window', async () => {
    // The half that matters. Without this pass the exclusion is permanent and
    // the biggest tenants grow without bound.
    const t = build({ subscriptions: [sub('premium-co', 365)] });
    await run(t);

    const second = (t.allWheres.proofOfPlay ?? [])[1];
    expect(second.companyId).toEqual({ in: ['premium-co'] });
    expect((second.startedAt.lt as Date).getTime()).toBe(NOW.getTime() - 365 * DAY);
  });

  it('uses the global cutoff for the global pass', async () => {
    const t = build({ subscriptions: [sub('premium-co', 365)] });
    await run(t);
    const first = (t.allWheres.proofOfPlay ?? [])[0];
    expect((first.startedAt.lt as Date).getTime()).toBe(NOW.getTime() - GLOBAL_DAYS * DAY);
  });

  it('applies both passes to EVERY tenant-scoped target', async () => {
    // A window honoured for proof-of-play but forgotten for heartbeats still
    // destroys the retention the customer paid for, just less visibly.
    const t = build({ subscriptions: [sub('premium-co', 365)] });
    await run(t);

    for (const target of [
      'proofOfPlay',
      'heartbeat',
      'alert',
      'emailDeliveryLog',
      'activityLog',
      'loginEvent',
      'notification',
      'deviceCommand',
      'screenshot',
      'scheduledReportDelivery',
    ]) {
      expect(scopes(t, target)).toEqual(
        expect.arrayContaining([{ notIn: ['premium-co'] }, { in: ['premium-co'] }]),
      );
    }
  });

  it('does NOT scope sessions or single-use auth tokens', async () => {
    // Dead auth material, not a business record. No plan sells "we keep your
    // revoked session rows for a year", and exempting them would grow the table
    // for nobody's benefit.
    const t = build({ subscriptions: [sub('premium-co', 365)] });
    await run(t);

    for (const target of ['session', 'passwordResetToken', 'twoFactorChallenge', 'pairingCode']) {
      expect(scopes(t, target).every((s: unknown) => s === undefined)).toBe(true);
    }
  });

  it('runs a single unscoped pass when no company qualifies', async () => {
    // The single-tenant / no-plan case must stay byte-identical to the old
    // behaviour — one pass, no predicate, no extra queries.
    const t = build({ subscriptions: [sub('basic-co', 30), sub('same-co', GLOBAL_DAYS)] });
    await run(t);
    expect(scopes(t, 'proofOfPlay')).toEqual([undefined]);
  });

  it('never shortens retention for a plan that promises LESS', async () => {
    // One-directional by design. Honouring a smaller value would start deleting
    // data that is kept today, and how long a customer's records are held is a
    // contractual question — not one an infrastructure change decides silently.
    const t = build({ subscriptions: [sub('basic-co', 7)] });
    const res = await run(t);
    expect(scopes(t, 'proofOfPlay')).toEqual([undefined]);
    expect(res.proofOfPlay).toBe(5); // pruned at the global window, as before
  });

  it('groups companies sharing a window into one pass', async () => {
    const t = build({ subscriptions: [sub('a-co', 365), sub('b-co', 365), sub('c-co', 180)] });
    await run(t);

    const passes = scopes(t, 'proofOfPlay');
    expect(passes[0].notIn.sort()).toEqual(['a-co', 'b-co', 'c-co']);
    // Two extra passes, not three: 365 is swept once for both companies.
    expect(passes).toHaveLength(3);
    expect(passes.slice(1)).toEqual(
      expect.arrayContaining([{ in: ['a-co', 'b-co'] }, { in: ['c-co'] }]),
    );
  });

  it('sums the deletions across every pass', async () => {
    const t = build({ subscriptions: [sub('premium-co', 365)] });
    const res = await run(t);
    // The mock drains its 5 eligible rows on the first pass; the second finds
    // none. The total must be the sum, never just the last pass's count.
    expect(res.proofOfPlay).toBe(5);
  });

  it.each([
    ['null', null],
    ['absent', undefined],
    ['a string', '365'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('ignores a %s dataRetentionDays and prunes globally', async (_l, value) => {
    // `limits` is untyped JSON. Treating a malformed value as "retain forever"
    // is how a table grows until the disk fills.
    const t = build({ subscriptions: [sub('odd-co', value)] });
    await run(t);
    expect(scopes(t, 'proofOfPlay')).toEqual([undefined]);
  });

  it('ignores an absurd window and prunes that company globally', async () => {
    // A plan-editor typo (an extra zero) must not produce a tenant that is
    // effectively never pruned — the failure mode of that is the disk filling
    // and every write failing platform-wide.
    const t = build({ subscriptions: [sub('typo-co', 3_650_000)] });
    const res = await run(t);
    expect(scopes(t, 'proofOfPlay')).toEqual([undefined]);
    expect(res.proofOfPlay).toBe(5);
  });

  it('accepts a window at the maximum', async () => {
    const t = build({ subscriptions: [sub('archive-co', 3650)] });
    await run(t);
    expect(scopes(t, 'proofOfPlay')[0]).toEqual({ notIn: ['archive-co'] });
  });

  it('falls back to a single global sweep when the lookup fails', async () => {
    // Fault isolation: an unreadable subscription table must not stop the disk
    // from being freed. It records a failure and prunes everything globally —
    // never the reverse, which would skip every company and grow unbounded.
    const t = build();
    t.prisma.subscription.findMany.mockRejectedValue(new Error('db down'));

    const res = await run(t);
    expect(scopes(t, 'proofOfPlay')).toEqual([undefined]);
    expect(res.proofOfPlay).toBe(5);
    expect(res.failures.join()).toMatch(/retentionWindows/);
  });

  it('labels a truncated window pass distinctly from the global one', async () => {
    // `truncated` drives the "backlog is growing" warning. A cap hit on the
    // 365-day pass reported as a global cap hit points the operator at the
    // wrong data.
    // 250k: the global pass drains its 100k cap, and the window pass then hits
    // the cap too. At 150k the second pass would fit under the cap and the
    // labelling would never be exercised.
    const t = build({ rows: { heartbeat: 250_000 }, subscriptions: [sub('premium-co', 365)] });
    const res = await t.service.run({ retentionDays: GLOBAL_DAYS, now: NOW });
    expect(res.truncated).toContain('heartbeats');
    expect(res.truncated.some((x) => x.includes('@365d'))).toBe(true);
  });

  it('tolerates a subscription with no plan', async () => {
    const t = build({ subscriptions: [{ companyId: 'orphan-co', plan: null }] });
    const res = await run(t);
    expect(res.failures).toEqual([]);
    expect(scopes(t, 'proofOfPlay')).toEqual([undefined]);
  });
});
