import { MonitoringService } from './monitoring.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const now = Date.now();
const fresh = new Date(now - 10_000);
const stale = new Date(now - 1000 * 60 * 10);

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
    heartbeat: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const screenshots = { latest: jest.fn().mockResolvedValue(null) };
  const service = new MonitoringService(prisma as any, screenshots as any);
  return { service, prisma };
}

describe('MonitoringService.overview', () => {
  it('counts statuses with live (derived) offline detection', async () => {
    const t = build([
      screen({
        id: 'a',
        status: 'ONLINE',
        device: {
          lastHeartbeatAt: fresh,
          status: 'ACTIVE',
          syncStatus: 'READY',
          cacheSizeBytes: null,
          failedDownloads: 0,
        },
      }),
      screen({
        id: 'b',
        status: 'ONLINE',
        device: {
          lastHeartbeatAt: stale,
          status: 'ACTIVE',
          cacheSizeBytes: null,
          failedDownloads: 2,
        },
      }),
      screen({ id: 'c', status: 'UNPAIRED', device: null }),
    ]);
    const res = await t.service.overview('comp1');
    expect(res.totals.online).toBe(1);
    expect(res.totals.offline).toBe(1);
    expect(res.totals.unpaired).toBe(1);
    expect(res.totals.total).toBe(3);
    expect(res.withFailedDownloads).toBe(1);
    expect(res.missingHeartbeat).toBe(1); // 'b' is paired but stale → offline
    expect(res.alerts.some((a) => a.screenId === 'b' && a.severity === 'CRITICAL')).toBe(true);
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
