import { NotFoundException } from '@nestjs/common';

import { HeartbeatService } from './heartbeat.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const device: any = { id: 'd1', deviceId: 'dev1', screenId: 's1', companyId: 'comp1' };

function build(screenStatus = 'OFFLINE') {
  const prisma: any = {
    screen: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 's1', status: screenStatus, heartbeatIntervalSeconds: 60 }),
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
