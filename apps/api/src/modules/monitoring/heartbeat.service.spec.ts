import { NotFoundException } from '@nestjs/common';

import { HeartbeatService } from './heartbeat.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const device: any = { id: 'd1', deviceId: 'dev1', screenId: 's1', companyId: 'comp1' };

function build(screenStatus = 'OFFLINE', previousDevice: any = null) {
  const prisma: any = {
    screen: {
      findFirst: jest.fn().mockResolvedValue({
        id: 's1',
        status: screenStatus,
        heartbeatIntervalSeconds: 60,
        device: previousDevice,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    device: { update: jest.fn().mockResolvedValue({}) },
    heartbeat: { create: jest.fn().mockResolvedValue({}) },
    deviceCommand: { count: jest.fn().mockResolvedValue(2) },
  };
  prisma.$transaction = jest.fn((arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
  );
  const alerts: any = {
    raise: jest.fn().mockResolvedValue({ alertId: 'a1', created: true }),
    resolveByKey: jest.fn().mockResolvedValue(0),
    screenKey: (c: string, s: string, t: string) => `${c}:${s}:${t}`,
  };
  const service = new HeartbeatService(prisma as any, alerts);
  return { service, prisma, alerts };
}

describe('HeartbeatService.record', () => {
  it('updates the device snapshot, flips the screen ONLINE, writes history, and reports pending commands', async () => {
    const t = build('OFFLINE');
    const res = await t.service.record(device, {
      playbackState: 'PLAYING',
      currentContentId: 'c1',
      cacheSizeBytes: 1000,
    });
    expect(t.prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({
          playbackState: 'PLAYING',
          lastHeartbeatAt: expect.any(Date),
        }),
      }),
    );
    expect(t.prisma.screen.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'ONLINE' }),
      }),
    );
    expect(t.prisma.heartbeat.create).toHaveBeenCalled();
    expect(res).toEqual(
      expect.objectContaining({ ok: true, status: 'ONLINE', pendingCommands: 2 }),
    );
  });

  it('reports WARNING when the heartbeat carries an error/partial sync', async () => {
    const t = build('ONLINE');
    const res = await t.service.record(device, { playbackState: 'ERROR' });
    expect(res.status).toBe('WARNING');
  });

  it('persists the reported error to the device snapshot so read-side status keeps it', async () => {
    const t = build('ONLINE');
    await t.service.record(device, { lastError: 'boom' });
    expect(t.prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastSyncError: 'boom' }) }),
    );
  });

  it('clears the snapshot error on a clean heartbeat', async () => {
    const t = build('ONLINE');
    await t.service.record(device, { playbackState: 'PLAYING' });
    expect(t.prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastSyncError: null }) }),
    );
  });

  it('never resurrects a DISABLED screen', async () => {
    const t = build('DISABLED');
    const res = await t.service.record(device, { playbackState: 'PLAYING' });
    expect(res.status).toBe('DISABLED');
    expect(t.prisma.screen.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DISABLED' }) }),
    );
  });

  it('rejects a heartbeat for a screen not in the device’s company', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(null);
    await expect(t.service.record(device, {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * Heartbeat history sampling.
 *
 * `heartbeats` is one row per screen per beat: 1,440/screen/day at a 60s
 * interval, ~1.4M/day across a 1,000-screen fleet, almost all identical to the
 * row before. Current state already lives on the Device row (written every beat
 * regardless), so a dense timeline buys nothing — but every state TRANSITION
 * must still be recorded exactly.
 */
describe('HeartbeatService history sampling', () => {
  const steady = {
    playbackState: 'PLAYING',
    syncStatus: 'SYNCED',
    lastSyncError: null,
    lastHeartbeatAt: new Date(Date.now() - 60_000), // one beat ago
  };
  const beat = { playbackState: 'PLAYING', syncStatus: 'SYNCED' } as any;

  it('skips the history row when nothing has changed since the last beat', async () => {
    const t = build('ONLINE', steady);
    await t.service.record(device, beat);
    expect(t.prisma.heartbeat.create).not.toHaveBeenCalled();
    // The live snapshot is still written every single beat.
    expect(t.prisma.device.update).toHaveBeenCalled();
    expect(t.prisma.screen.update).toHaveBeenCalled();
  });

  it('records a row when the screen status changes', async () => {
    const t = build('OFFLINE', steady); // OFFLINE -> ONLINE
    await t.service.record(device, beat);
    expect(t.prisma.heartbeat.create).toHaveBeenCalled();
  });

  it('records a row when playback state changes', async () => {
    const t = build('ONLINE', steady);
    await t.service.record(device, { ...beat, playbackState: 'STOPPED' });
    expect(t.prisma.heartbeat.create).toHaveBeenCalled();
  });

  it('records a row when sync state changes', async () => {
    const t = build('ONLINE', steady);
    await t.service.record(device, { ...beat, syncStatus: 'FAILED' });
    expect(t.prisma.heartbeat.create).toHaveBeenCalled();
  });

  it('records a row when an error appears — and again when it clears', async () => {
    const appearing = build('ONLINE', steady);
    await appearing.service.record(device, { ...beat, lastError: 'decoder failure' });
    expect(appearing.prisma.heartbeat.create).toHaveBeenCalled();

    const clearing = build('WARNING', { ...steady, lastSyncError: 'decoder failure' });
    await clearing.service.record(device, beat);
    expect(clearing.prisma.heartbeat.create).toHaveBeenCalled();
  });

  it('takes a keepalive sample once the interval has elapsed', async () => {
    const t = build('ONLINE', { ...steady, lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) });
    await t.service.record(device, beat);
    expect(t.prisma.heartbeat.create).toHaveBeenCalled();
  });

  it('always records the very first beat from a device', async () => {
    const t = build('ONLINE', { ...steady, lastHeartbeatAt: null });
    await t.service.record(device, beat);
    expect(t.prisma.heartbeat.create).toHaveBeenCalled();
  });

  it('records a row when there is no device snapshot at all', async () => {
    const t = build('ONLINE', null);
    await t.service.record(device, beat);
    expect(t.prisma.heartbeat.create).toHaveBeenCalled();
  });
});
