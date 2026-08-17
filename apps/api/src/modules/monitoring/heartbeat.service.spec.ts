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
        currentContentId: null,
        currentPlaylistId: null,
        appVersion: null,
        device: previousDevice,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    device: { update: jest.fn().mockResolvedValue({}) },
    heartbeat: { create: jest.fn().mockResolvedValue({}) },
    deviceCommand: { findFirst: jest.fn().mockResolvedValue({ id: 'cmd1' }) },
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
  it('updates the device snapshot, flips the screen ONLINE, writes history, and reports command existence', async () => {
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
        data: expect.objectContaining({ status: 'ONLINE', currentContentId: 'c1' }),
      }),
    );
    expect(t.prisma.heartbeat.create).toHaveBeenCalled();
    expect(t.prisma.deviceCommand.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true } }),
    );
    expect(res).toEqual(
      expect.objectContaining({ ok: true, status: 'ONLINE', pendingCommands: 1 }),
    );
  });

  it('returns zero without COUNT when no command exists', async () => {
    const t = build('ONLINE', {
      playbackState: 'PLAYING',
      syncStatus: null,
      lastSyncError: null,
      lastHeartbeatAt: new Date(),
    });
    t.prisma.deviceCommand.findFirst.mockResolvedValue(null);

    const res = await t.service.record(device, { playbackState: 'PLAYING' });

    expect(res.pendingCommands).toBe(0);
    expect(t.prisma.deviceCommand.count).toBeUndefined();
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

  it('never resurrects or rewrites a steady DISABLED screen', async () => {
    const t = build('DISABLED', {
      playbackState: 'PLAYING',
      syncStatus: null,
      lastSyncError: null,
      lastHeartbeatAt: new Date(),
    });
    const res = await t.service.record(device, { playbackState: 'PLAYING' });
    expect(res.status).toBe('DISABLED');
    expect(t.prisma.screen.update).not.toHaveBeenCalled();
  });

  it('rejects a heartbeat for a screen not in the device’s company inside the transaction', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(null);
    await expect(t.service.record(device, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(t.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
  });
});

describe('HeartbeatService history sampling and screen write suppression', () => {
  const steady = {
    playbackState: 'PLAYING',
    syncStatus: 'SYNCED',
    lastSyncError: null,
    lastHeartbeatAt: new Date(Date.now() - 60_000),
  };
  const beat = { playbackState: 'PLAYING', syncStatus: 'SYNCED' } as any;

  it('skips history and the denormalized screen write when nothing changed', async () => {
    const t = build('ONLINE', steady);
    await t.service.record(device, beat);
    expect(t.prisma.heartbeat.create).not.toHaveBeenCalled();
    expect(t.prisma.device.update).toHaveBeenCalled();
    expect(t.prisma.screen.update).not.toHaveBeenCalled();
  });

  it('records history and updates screen when screen status changes', async () => {
    const t = build('OFFLINE', steady);
    await t.service.record(device, beat);
    expect(t.prisma.heartbeat.create).toHaveBeenCalled();
    expect(t.prisma.screen.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ONLINE' }) }),
    );
  });

  it('updates the screen snapshot when current content changes even if status is steady', async () => {
    const t = build('ONLINE', steady);
    await t.service.record(device, { ...beat, currentContentId: 'content-new' });
    expect(t.prisma.screen.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentContentId: 'content-new' }),
      }),
    );
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

  it('takes a keepalive sample once the interval has elapsed without rewriting Screen', async () => {
    const t = build('ONLINE', { ...steady, lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) });
    await t.service.record(device, beat);
    expect(t.prisma.heartbeat.create).toHaveBeenCalled();
    expect(t.prisma.screen.update).not.toHaveBeenCalled();
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
