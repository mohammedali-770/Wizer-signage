import { AndroidOtaHealthService } from './android-ota-health.service';

const now = new Date('2026-08-09T09:20:00.000Z');
const policy = {
  enabled: true,
  policyRevision: '2026-08-09T09:00:00.000Z',
  targetVersionName: '1.4.2',
  targetVersionCode: 42,
  rollbackVersionName: '1.4.1-safe',
  rollbackVersionCode: 43,
  rolloutPercent: 5,
  screenIds: [],
  groupIds: [],
  checkIntervalSeconds: 3600,
  healthWindowSeconds: 600,
  lastAutoRollback: null,
};

function screen(overrides: Record<string, unknown> = {}) {
  return {
    id: 'screen-1',
    appVersion: null,
    lastHeartbeatAt: null,
    capabilities: {
      androidOta: {
        state: 'INSTALLED',
        policyRevision: policy.policyRevision,
        targetVersionCode: 42,
        reportedAt: '2026-08-09T09:05:00.000Z',
      },
    },
    device: {
      playbackState: 'PLAYING',
      syncStatus: 'OK',
      lastSyncError: null,
    },
    ...overrides,
  };
}

function harness(
  screens: ReturnType<typeof screen>[],
  executeResult = 1,
  rollbackAvailable = true,
) {
  const prisma = {
    company: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'company-1', settings: { androidOta: policy } }]),
    },
    screen: { findMany: jest.fn().mockResolvedValue(screens) },
    $executeRaw: jest.fn().mockResolvedValue(executeResult),
  };
  const alerts = { raise: jest.fn().mockResolvedValue({ alertId: 'a1', created: true }) };
  const releases = {
    find: jest
      .fn()
      .mockReturnValue(
        rollbackAvailable
          ? { versionName: policy.rollbackVersionName, versionCode: 43, fileName: 'safe.apk' }
          : null,
      ),
  };
  const service = new AndroidOtaHealthService(prisma as never, alerts as never, releases as never);
  return { service, prisma, alerts, releases };
}

describe('AndroidOtaHealthService', () => {
  it('accepts a post-install clean heartbeat from the exact candidate as healthy', async () => {
    const t = harness([
      screen({
        appVersion: '1.4.2',
        lastHeartbeatAt: new Date('2026-08-09T09:06:00.000Z'),
      }),
    ]);

    await expect(t.service.sweep(now)).resolves.toEqual({
      checkedPolicies: 1,
      failedScreens: 0,
      autoRevertedPolicies: 0,
      haltedMissingRollback: 0,
    });
    expect(t.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(t.releases.find).not.toHaveBeenCalled();
    expect(t.alerts.raise).not.toHaveBeenCalled();
  });

  it('auto-switches the rollout to the pre-published higher known-good build after the health window', async () => {
    const t = harness([screen()]);

    await expect(t.service.sweep(now)).resolves.toEqual({
      checkedPolicies: 1,
      failedScreens: 1,
      autoRevertedPolicies: 1,
      haltedMissingRollback: 0,
    });
    expect(t.releases.find).toHaveBeenCalledWith('1.4.1-safe', 43);
    expect(t.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(t.alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        type: 'android.ota.auto_rollback',
        severity: 'CRITICAL',
        informational: true,
        metadata: expect.objectContaining({
          fromVersionCode: 42,
          toVersionCode: 43,
          failedScreenIds: ['screen-1'],
          rollbackAvailable: true,
        }),
      }),
    );
  });

  it('does not alert or overwrite when an operator changed policy revision concurrently', async () => {
    const t = harness([screen()], 0);

    const result = await t.service.sweep(now);

    expect(result.failedScreens).toBe(1);
    expect(result.autoRevertedPolicies).toBe(0);
    expect(result.haltedMissingRollback).toBe(0);
    expect(t.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(t.alerts.raise).not.toHaveBeenCalled();
  });

  it('halts new installs and leaves a critical open alert if the rollback artifact disappeared', async () => {
    const t = harness([screen()], 1, false);

    await expect(t.service.sweep(now)).resolves.toEqual({
      checkedPolicies: 1,
      failedScreens: 1,
      autoRevertedPolicies: 0,
      haltedMissingRollback: 1,
    });
    expect(t.alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Android OTA halted — rollback artifact unavailable',
        severity: 'CRITICAL',
        informational: false,
        metadata: expect.objectContaining({ rollbackAvailable: false }),
      }),
    );
  });

  it('ignores old-revision attempts after the same candidate is explicitly re-saved', async () => {
    const t = harness([
      screen({
        capabilities: {
          androidOta: {
            state: 'INSTALLED',
            policyRevision: '2026-08-09T08:00:00.000Z',
            targetVersionCode: 42,
            reportedAt: '2026-08-09T08:01:00.000Z',
          },
        },
      }),
    ]);

    const result = await t.service.sweep(now);

    expect(result.failedScreens).toBe(0);
    expect(t.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(t.alerts.raise).not.toHaveBeenCalled();
  });

  it('ignores non-terminal pre-install state and unrelated target attempts', async () => {
    const t = harness([
      screen({
        capabilities: {
          androidOta: {
            state: 'DOWNLOADED',
            policyRevision: policy.policyRevision,
            targetVersionCode: 42,
            reportedAt: '2026-08-09T09:00:00.000Z',
          },
        },
      }),
      screen({
        id: 'screen-2',
        capabilities: {
          androidOta: {
            state: 'INSTALLED',
            policyRevision: policy.policyRevision,
            targetVersionCode: 41,
            reportedAt: '2026-08-09T09:00:00.000Z',
          },
        },
      }),
    ]);

    const result = await t.service.sweep(now);

    expect(result.failedScreens).toBe(0);
    expect(t.prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
