import { NotFoundException } from '@nestjs/common';

import { DeviceCommandService } from './device-command.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const actor: any = { userId: 'u1', companyId: 'comp1', role: 'COMPANY_ADMIN' };
const device: any = { id: 'd1', deviceId: 'dev1', screenId: 's1', companyId: 'comp1' };

function command(over: any = {}) {
  return {
    id: 'cmd1',
    companyId: 'comp1',
    screenId: 's1',
    deviceId: 'd1',
    commandType: 'FORCE_SYNC',
    status: 'PENDING',
    payload: {},
    result: null,
    error: null,
    issuedById: 'u1',
    deliveredAt: null,
    startedAt: null,
    completedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function build() {
  const prisma: any = {
    screen: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
    device: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'ACTIVE' }) },
    deviceCommand: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(command(data))),
      findFirst: jest.fn().mockResolvedValue(command()),
      findMany: jest.fn().mockResolvedValue([command()]),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  prisma.$transaction = jest.fn((arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
  );
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new DeviceCommandService(prisma as any, activityLog as any);
  return { service, prisma, activityLog };
}

describe('DeviceCommandService.issue', () => {
  it('creates a PENDING command for an own-company screen and logs', async () => {
    const t = build();
    await t.service.issue('comp1', actor, 's1', 'FORCE_SYNC' as any);
    expect(t.prisma.deviceCommand.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'comp1',
          screenId: 's1',
          commandType: 'FORCE_SYNC',
          status: 'PENDING',
        }),
      }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'device.command_force_sync' }),
    );
  });

  it('rejects issuing to a screen in another company (404)', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(null);
    await expect(
      t.service.issue('comp1', actor, 'other', 'FORCE_SYNC' as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DeviceCommandService device side', () => {
  it('returns pending commands for the device’s own screen and marks them DELIVERED', async () => {
    const t = build();
    t.prisma.deviceCommand.findMany.mockResolvedValue([command({ id: 'cmd1' })]);
    const res = await t.service.pending(device);
    // expires stale, then delivers
    expect(t.prisma.deviceCommand.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DELIVERED' }) }),
    );
    expect(res.commands.map((c) => c.id)).toEqual(['cmd1']);
  });

  it('acks a command (PENDING/DELIVERED → RUNNING), scoped to the device', async () => {
    const t = build();
    t.prisma.deviceCommand.findFirst.mockResolvedValue(command({ status: 'DELIVERED' }));
    await t.service.ack(device, 'cmd1');
    expect(t.prisma.deviceCommand.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cmd1', screenId: 's1', companyId: 'comp1' } }),
    );
    expect(t.prisma.deviceCommand.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RUNNING' }) }),
    );
  });

  it('records a result (SUCCEEDED/FAILED) for the device’s own command', async () => {
    const t = build();
    await t.service.result(device, 'cmd1', { status: 'SUCCEEDED' as any, result: { ok: true } });
    expect(t.prisma.deviceCommand.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCEEDED', completedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects acking a command not belonging to the device (404)', async () => {
    const t = build();
    t.prisma.deviceCommand.findFirst.mockResolvedValue(null);
    await expect(t.service.ack(device, 'other')).rejects.toBeInstanceOf(NotFoundException);
  });
});
