import { MonitoringService } from './monitoring.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const now = Date.now();
const fresh = new Date(now - 10_000);

function screen(over: any = {}) {
  return {
    id: 's',
    name: 'Screen',
    status: 'ONLINE',
    lastHeartbeatAt: null,
    heartbeatIntervalSeconds: 60,
    appVersion: '1.0',
    location: { id: 'loc', name: 'Lobby' },
    device: null,
    ...over,
  };
}

function build(screens: any[]) {
  const prisma: any = {
    screen: {
      findMany: jest.fn().mockResolvedValue(screens),
      findFirst: jest.fn().mockResolvedValue(screens[0]),
    },
    device: {
      groupBy: jest.fn().mockResolvedValue([{ syncStatus: 'READY', _count: { _all: 2 } }]),
    },
    heartbeat: { findFirst: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([
        {
          total: 3n,
          online: 1n,
          offline: 1n,
          warning: 0n,
          unpaired: 1n,
          pairing: 0n,
          disabled: 0n,
          archived: 0n,
          with_failed_downloads: 1n,
          missing_heartbeat: 1n,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'b',
          name: 'B',
          live_status: 'OFFLINE',
          warning_reason: null,
        },
      ]),
  };
  const screenshots = { latest: jest.fn().mockResolvedValue(null) };
  const service = new MonitoringService(prisma as any, screenshots as any);
  return { service, prisma };
}

describe('MonitoringService.overview', () => {
  it('uses whole-fleet aggregate counts while returning only the requested screen page', async () => {
    const t = build([
      screen({
        id: 'a',
        device: {
          lastHeartbeatAt: fresh,
          status: 'ACTIVE',
          syncStatus: 'READY',
          lastSyncError: null,
          playbackState: 'PLAYING',
          cacheSizeBytes: null,
          failedDownloads: 0,
        },
      }),
    ]);

    const res = await t.service.overview('comp1', { page: 2, pageSize: 1 });
    expect(res.totals).toMatchObject({ total: 3, online: 1, offline: 1, unpaired: 1 });
    expect(res.withFailedDownloads).toBe(1);
    expect(res.missingHeartbeat).toBe(1);
    expect(res.screens).toHaveLength(1);
    expect(res.screenMeta).toEqual({ page: 2, pageSize: 1, total: 3, totalPages: 3 });
    expect(res.alerts).toEqual([expect.objectContaining({ screenId: 'b', severity: 'CRITICAL' })]);
    expect(t.prisma.screen.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 1, take: 1 }),
    );
  });

  it('caps alert payloads and signals truncation', async () => {
    const t = build([]);
    t.prisma.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([
        {
          total: 0n,
          online: 0n,
          offline: 0n,
          warning: 0n,
          unpaired: 0n,
          pairing: 0n,
          disabled: 0n,
          archived: 0n,
          with_failed_downloads: 0n,
          missing_heartbeat: 0n,
        },
      ])
      .mockResolvedValueOnce(
        Array.from({ length: 201 }, (_, i) => ({
          id: `s-${i}`,
          name: `Screen ${i}`,
          live_status: 'WARNING',
          warning_reason: 'Warning.',
        })),
      );

    const res = await t.service.overview('comp1');
    expect(res.alerts).toHaveLength(200);
    expect(res.alertsTruncated).toBe(true);
  });
});

describe('MonitoringService.screenMonitoring', () => {
  it('returns ONLINE + telemetry + default capabilities for a fresh heartbeat', async () => {
    const t = build([
      screen({
        id: 's1',
        status: 'ONLINE',
        device: {
          lastHeartbeatAt: fresh,
          status: 'ACTIVE',
          playbackState: 'PLAYING',
          syncStatus: 'READY',
          lastSyncError: null,
          cacheSizeBytes: null,
          availableStorageBytes: null,
          modelName: 'TV',
          osVersion: 'Android 12',
        },
      }),
    ]);
    const res = await t.service.screenMonitoring('comp1', 's1');
    expect(res.status).toBe('ONLINE');
    expect(res.telemetry?.playbackState).toBe('PLAYING');
    expect(res.capabilities.screenshot).toBe(true);
    expect(res.capabilities.reboot).toBe(false);
  });
});
