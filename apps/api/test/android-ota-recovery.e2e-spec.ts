import { PrismaClient } from '@prisma/client';

import { AndroidOtaHealthService } from '../src/modules/maintenance/android-ota-health.service';

/**
 * Android OTA unhealthy-recovery — the drill in docs/production-cutover.md §7,
 * step 8, as an executable check:
 *
 *   "Deliberately make a lab/canary miss the health window and prove the policy
 *    atomically advances the same cohort to the pre-staged higher-version
 *    known-good release."
 *
 * android-ota-health.service.spec.ts covers the decision logic with Prisma fully
 * mocked, which is the right shape for "which screens count as failing". It
 * cannot cover the part that makes this safe to run unattended: the transition
 * is a single raw statement — `jsonb_set` on one key, guarded by a
 * policyRevision predicate — and a mock that resolves 1 or 0 only proves how the
 * service REACTS to a row count, never that the statement produces the right
 * one. Concurrency, key-level merge and paging are all invisible to it.
 *
 * So these run against the real database: the operator race is a genuine
 * interleaving rather than a stubbed return value, and the page boundary is
 * crossed with real rows.
 */
const prisma = new PrismaClient();

/**
 * Every row this spec creates is namespaced. `pnpm test:e2e` runs files in
 * parallel workers against one database, so a spec that truncates shared tables
 * deletes another spec's fixtures out from under it. Scope deletes the way
 * refresh-cookie / two-factor-reauth / telemetry-partitioning already do.
 *
 * The sweep's own counters are database-wide, so the few assertions made on them
 * assume this spec owns the only ARMED androidOta policies while it runs. That
 * holds because no other spec writes that settings key; if one ever does, these
 * fail loudly rather than silently, and the owned-row assertions below are the
 * ones that actually pin the behaviour.
 */
const SUFFIX = 'android-ota-recovery-e2e';
const co = (n: string | number) => `${SUFFIX}-${n}`;

const CANDIDATE = { name: '1.4.2', code: 42 };
const RECOVERY = { name: '1.4.1-safe', code: 43 };
const REVISION = '2026-08-09T09:00:00.000Z';
// 15 minutes after the install was reported; the health window below is 10.
const NOW = new Date('2026-08-09T09:20:00.000Z');

type Alert = { informational?: boolean; metadata?: Record<string, unknown> };

const alerts = {
  raised: [] as Alert[],
  async raise(input: Alert) {
    alerts.raised.push(input);
    return { alertId: 'test', created: true };
  },
};

const releases = {
  available: true,
  find(versionName: string, versionCode: number) {
    return releases.available ? { versionName, versionCode, fileName: 'x.apk' } : null;
  },
};

const service = new AndroidOtaHealthService(prisma as never, alerts as never, releases as never);

function policy(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    policyRevision: REVISION,
    targetVersionName: CANDIDATE.name,
    targetVersionCode: CANDIDATE.code,
    rollbackVersionName: RECOVERY.name,
    rollbackVersionCode: RECOVERY.code,
    rolloutPercent: 5,
    screenIds: [],
    groupIds: [],
    checkIntervalSeconds: 3600,
    healthWindowSeconds: 600,
    lastAutoRollback: null,
    ...overrides,
  };
}

/** A screen that reported INSTALLED and then never proved itself healthy. */
function attempt() {
  return {
    androidOta: {
      state: 'INSTALLED',
      policyRevision: REVISION,
      targetVersionCode: CANDIDATE.code,
      reportedAt: '2026-08-09T09:05:00.000Z',
    },
  };
}

async function wipe() {
  const owned = { companyId: { startsWith: SUFFIX } };
  await prisma.device.deleteMany({ where: owned });
  await prisma.screen.deleteMany({ where: owned });
  await prisma.company.deleteMany({ where: { id: { startsWith: SUFFIX } } });
}

async function seedCompany(
  id: string,
  opts: { healthy?: boolean; extraSettings?: Record<string, unknown> } = {},
) {
  await prisma.company.create({
    data: {
      id,
      name: `Co ${id}`,
      slug: id,
      settings: { androidOta: policy(), ...(opts.extraSettings ?? {}) },
    } as never,
  });
  await prisma.screen.create({
    data: {
      id: `scr-${id}`,
      companyId: id,
      name: 'Canary',
      // Healthy means the screen came back on the candidate version after the
      // install; unhealthy means it is still reporting the old build.
      appVersion: opts.healthy ? CANDIDATE.name : RECOVERY.name,
      lastHeartbeatAt: opts.healthy ? new Date('2026-08-09T09:06:00.000Z') : null,
      capabilities: attempt(),
    } as never,
  });
  await prisma.device.create({
    data: {
      id: `dev-${id}`,
      companyId: id,
      screenId: `scr-${id}`,
      deviceId: `android-${id}`,
      playbackState: 'PLAYING',
      syncStatus: 'READY',
      lastSyncError: null,
    } as never,
  });
}

async function readPolicy(id: string) {
  const row = await prisma.company.findUnique({ where: { id }, select: { settings: true } });
  return (row?.settings as Record<string, Record<string, unknown>> | null)?.androidOta;
}

describe('Android OTA unhealthy-recovery (real database)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    alerts.raised = [];
    releases.available = true;
    await wipe();
  });

  it('advances the same cohort to the pre-staged higher-version build', async () => {
    await seedCompany(co(1), {
      extraSettings: { branding: { logoUrl: 'https://example.invalid/logo.png' } },
    });

    const result = await service.sweep(NOW);
    expect(result).toMatchObject({ failedScreens: 1, autoRevertedPolicies: 1 });

    const after = await readPolicy(co(1));
    expect(after).toMatchObject({
      enabled: true,
      targetVersionName: RECOVERY.name,
      targetVersionCode: RECOVERY.code,
      // The cohort is carried over untouched. Widening or resetting it here
      // would push the recovery build to screens that were never on the
      // candidate.
      rolloutPercent: 5,
      screenIds: [],
      // Android refuses to install a lower versionCode, which is why the
      // recovery build has to be published ABOVE the candidate.
      rollbackVersionName: null,
      rollbackVersionCode: null,
    });
    expect(after?.policyRevision).not.toBe(REVISION);
    expect((after?.lastAutoRollback as { failedScreenIds: string[] }).failedScreenIds).toEqual([
      `scr-${co(1)}`,
    ]);
    expect(alerts.raised).toHaveLength(1);
    expect(alerts.raised[0]?.informational).toBe(true);
  });

  it('writes only the androidOta key, leaving other settings intact', async () => {
    await seedCompany(co(1), {
      extraSettings: { branding: { logoUrl: 'https://example.invalid/logo.png' } },
    });

    await service.sweep(NOW);

    // The transition uses jsonb_set rather than writing back a settings object
    // read earlier, so an unrelated concurrent settings change is not lost.
    const row = await prisma.company.findUnique({
      where: { id: co(1) },
      select: { settings: true },
    });
    expect((row?.settings as { branding?: { logoUrl?: string } })?.branding?.logoUrl).toBe(
      'https://example.invalid/logo.png',
    );
  });

  it('does not act twice — recovery leaves nothing left to sweep', async () => {
    await seedCompany(co(1));
    await service.sweep(NOW);
    const afterFirst = await readPolicy(co(1));
    alerts.raised = [];

    // The spent rollback coordinate was cleared, so the policy no longer arms a
    // rollout. A second sweep must not re-alert or churn the revision.
    const second = await service.sweep(new Date('2026-08-09T09:40:00.000Z'));

    expect(second).toMatchObject({ checkedPolicies: 0, autoRevertedPolicies: 0 });
    expect((await readPolicy(co(1)))?.policyRevision).toBe(afterFirst?.policyRevision);
    expect(alerts.raised).toHaveLength(0);
  });

  it('leaves a healthy canary alone', async () => {
    await seedCompany(co(1), { healthy: true });

    const result = await service.sweep(NOW);

    expect(result).toMatchObject({ failedScreens: 0, autoRevertedPolicies: 0 });
    expect(await readPolicy(co(1))).toMatchObject({
      targetVersionCode: CANDIDATE.code,
      policyRevision: REVISION,
    });
    expect(alerts.raised).toHaveLength(0);
  });

  it('loses to an operator who saves a new policy mid-sweep', async () => {
    await seedCompany(co(1));
    const operatorPolicy = policy({
      policyRevision: '2026-08-09T09:19:00.000Z',
      targetVersionName: '1.5.0',
      targetVersionCode: 50,
      rollbackVersionName: '1.5.1-safe',
      rollbackVersionCode: 51,
    });

    // Interleave for real: the operator hits Save after the sweep has read the
    // screens and before it writes. The revision predicate has to lose.
    const racy = new Proxy(prisma, {
      get(target: Record<string, unknown>, prop: string) {
        if (prop === 'screen') {
          return {
            findMany: async (...args: unknown[]) => {
              const rows = await (
                target.screen as { findMany: (...a: unknown[]) => Promise<unknown> }
              ).findMany(...args);
              await prisma.company.update({
                where: { id: co(1) },
                data: { settings: { androidOta: operatorPolicy } as never },
              });
              return rows;
            },
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    } as never);

    const result = await new AndroidOtaHealthService(
      racy as never,
      alerts as never,
      releases as never,
    ).sweep(NOW);

    expect(result).toMatchObject({ failedScreens: 1, autoRevertedPolicies: 0 });
    expect(await readPolicy(co(1))).toMatchObject({
      policyRevision: operatorPolicy.policyRevision,
      targetVersionCode: 50,
    });
    // Claiming a revert that did not happen would be worse than the failure it
    // is reporting.
    expect(alerts.raised).toHaveLength(0);
  });

  it('halts instead of reverting when the recovery build is no longer published', async () => {
    await seedCompany(co(1));
    releases.available = false;

    const result = await service.sweep(NOW);

    expect(result).toMatchObject({ autoRevertedPolicies: 0, haltedMissingRollback: 1 });
    expect(await readPolicy(co(1))).toMatchObject({
      enabled: false,
      // Never point the fleet at a build that cannot be verified.
      targetVersionCode: CANDIDATE.code,
    });
    expect(alerts.raised[0]?.informational).not.toBe(true);
  });

  it('sweeps past the company page boundary', async () => {
    // Companies are paged 500 at a time behind a cursor. A paging bug does not
    // fail loudly — it silently leaves whole fleets stranded on a broken build
    // with no recovery, and a single-company test cannot see it.
    const N = 501;
    const id = (i: number) => co(String(i).padStart(4, '0'));
    await prisma.company.createMany({
      data: Array.from({ length: N }, (_, i) => ({
        id: id(i),
        name: `Co ${i}`,
        slug: id(i),
        settings: { androidOta: policy() },
      })) as never,
    });
    await prisma.screen.createMany({
      data: Array.from({ length: N }, (_, i) => ({
        id: `scr-${id(i)}`,
        companyId: id(i),
        name: 'Canary',
        appVersion: RECOVERY.name,
        lastHeartbeatAt: null,
        capabilities: attempt(),
      })) as never,
    });
    await prisma.device.createMany({
      data: Array.from({ length: N }, (_, i) => ({
        id: `dev-${id(i)}`,
        companyId: id(i),
        screenId: `scr-${id(i)}`,
        deviceId: `android-${id(i)}`,
        playbackState: 'PLAYING',
        syncStatus: 'READY',
        lastSyncError: null,
      })) as never,
    });

    const result = await service.sweep(NOW);

    // >= rather than ==: the sweep counts every armed policy in the database,
    // and this spec does not own the whole database. Crossing 500 at all is the
    // property under test; exactness is asserted below against owned rows only.
    expect(result.checkedPolicies).toBeGreaterThanOrEqual(N);
    expect(result.autoRevertedPolicies).toBeGreaterThanOrEqual(N);

    const stranded = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
        FROM "companies"
       WHERE "id" LIKE ${`${SUFFIX}%`}
         AND "settings"->'androidOta'->>'targetVersionCode' <> ${String(RECOVERY.code)}`;
    expect(Number(stranded[0]?.count)).toBe(0);
    expect(alerts.raised.length).toBeGreaterThanOrEqual(N);
  });
});
