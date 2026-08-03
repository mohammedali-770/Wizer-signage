import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { ScreensService } from './screens.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SCREEN_ROW = {
  id: 's1',
  companyId: 'c1',
  kioskPinHash: null,
  location: null,
  tags: [],
  groups: [],
};

function build() {
  const prisma: any = {
    screen: {
      create: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve({ ...SCREEN_ROW, kioskPinHash: data.kioskPinHash ?? null }),
        ),
      findFirst: jest.fn().mockResolvedValue({ ...SCREEN_ROW }),
      update: jest.fn().mockResolvedValue({ ...SCREEN_ROW }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    location: { findFirst: jest.fn().mockResolvedValue({ id: 'loc1' }) },
    tag: { findMany: jest.fn() },
    screenGroup: { findMany: jest.fn() },
    screenTag: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    screenGroupMember: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    device: {
      findUnique: jest.fn().mockResolvedValue({ deviceId: 'dev-1', status: 'ACTIVE' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    pairingCode: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  // Both transaction forms: interactive (callback) and sequential (array).
  prisma.$transaction = jest.fn((arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
  );
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const usageLimits = { assertCanAdd: jest.fn().mockResolvedValue(undefined) };
  const password = { hash: jest.fn().mockResolvedValue('hashed-pin') };
  const service = new ScreensService(
    prisma,
    activityLog as any,
    usageLimits as any,
    password as any,
  );
  return { service, prisma, activityLog, usageLimits, password };
}

const actor: any = { userId: 'u1', isSuperAdmin: false, companyId: 'c1', role: 'COMPANY_ADMIN' };

describe('ScreensService.create', () => {
  it('enforces the screen plan limit and logs creation', async () => {
    const t = build();
    await t.service.create('c1', actor, { name: 'Lobby' });
    expect(t.usageLimits.assertCanAdd).toHaveBeenCalledWith('c1', 'screens');
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'screen.created' }),
    );
  });

  it('blocks creation when the limit/grace check rejects', async () => {
    const t = build();
    t.usageLimits.assertCanAdd.mockRejectedValue(new ForbiddenException('limit'));
    await expect(t.service.create('c1', actor, { name: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(t.prisma.screen.create).not.toHaveBeenCalled();
  });

  it('stores the kiosk PIN hashed, never raw, and never returns the hash', async () => {
    const t = build();
    const result: any = await t.service.create('c1', actor, { name: 'Lobby', kioskPin: '1234' });
    expect(t.password.hash).toHaveBeenCalledWith('1234');
    const createArg = t.prisma.screen.create.mock.calls[0][0];
    expect(createArg.data.kioskPinHash).toBe('hashed-pin');
    expect(createArg.data.kioskPinHash).not.toBe('1234');
    expect(result.hasKioskPin).toBe(true);
    expect(result.kioskPinHash).toBeUndefined();
  });
});

describe('ScreensService tags/groups', () => {
  it('assigns tags after validating they belong to the company, and logs', async () => {
    const t = build();
    t.prisma.tag.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    await t.service.assignTags('c1', actor, 's1', ['t1', 't2']);
    expect(t.prisma.screenTag.deleteMany).toHaveBeenCalledWith({ where: { screenId: 's1' } });
    expect(t.prisma.screenTag.createMany).toHaveBeenCalled();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'screen.tags_assigned' }),
    );
  });

  it('rejects assigning a tag from another company', async () => {
    const t = build();
    t.prisma.tag.findMany.mockResolvedValue([{ id: 't1' }]); // only 1 of 2 valid
    await expect(t.service.assignTags('c1', actor, 's1', ['t1', 'foreign'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('replaces group memberships and logs', async () => {
    const t = build();
    t.prisma.screenGroup.findMany.mockResolvedValue([{ id: 'g1' }]);
    await t.service.assignGroups('c1', actor, 's1', ['g1']);
    expect(t.prisma.screenGroupMember.deleteMany).toHaveBeenCalledWith({
      where: { screenId: 's1' },
    });
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'screen.groups_assigned' }),
    );
  });
});

describe('ScreensService company scoping & lifecycle', () => {
  it('returns 404 for a screen outside the tenant', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(null);
    await expect(t.service.getScopedOrThrow('c1', 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('archives and reactivates with the right audit action', async () => {
    const t = build();
    await t.service.setStatus('c1', actor, 's1', 'ARCHIVED' as any);
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'screen.archived' }),
    );
    await t.service.setStatus('c1', actor, 's1', 'UNPAIRED' as any);
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'screen.reactivated' }),
    );
  });

  it('re-checks the plan limit when reactivating an ARCHIVED screen', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue({ ...SCREEN_ROW, status: 'ARCHIVED' });
    await t.service.setStatus('c1', actor, 's1', 'UNPAIRED' as any);
    expect(t.usageLimits.assertCanAdd).toHaveBeenCalledWith('c1', 'screens');
  });
});

/**
 * Deleting a screen must also release the physical device.
 *
 * Before this, deletion set `deletedAt` and nothing else: the paired TV kept a
 * valid device token and kept polling a screen the customer believes is gone,
 * and the screen kept its globally-unique `deviceIdentifier`, so pairing that
 * same TV to a new screen failed permanently with no UI to fix it.
 */
describe('ScreensService.remove — device lifecycle', () => {
  it('soft-deletes the screen and releases its device identifier', async () => {
    const t = build();
    await t.service.remove('c1', actor, 's1');

    expect(t.prisma.screen.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          status: 'ARCHIVED',
          deviceIdentifier: null,
        }),
      }),
    );
  });

  it('revokes the device token so the TV stops polling a deleted screen', async () => {
    const t = build();
    await t.service.remove('c1', actor, 's1');

    expect(t.prisma.device.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { screenId: 's1', status: { not: 'REVOKED' } },
        data: expect.objectContaining({ status: 'REVOKED', deviceTokenHash: null }),
      }),
    );
  });

  it('revokes any outstanding pairing code for the deleted screen', async () => {
    const t = build();
    await t.service.remove('c1', actor, 's1');

    expect(t.prisma.pairingCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { screenId: 's1', status: { in: ['PENDING', 'CLAIMED'] } },
        data: { status: 'REVOKED' },
      }),
    );
  });

  it('does everything in one transaction — never a half-deleted screen', async () => {
    const t = build();
    await t.service.remove('c1', actor, 's1');
    expect(t.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(t.prisma.$transaction.mock.calls[0][0]).toHaveLength(3);
  });

  it('deletes a never-paired screen without failing on the missing device row', async () => {
    const t = build();
    t.prisma.device.findUnique.mockResolvedValue(null);
    await expect(t.service.remove('c1', actor, 's1')).resolves.toBeUndefined();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'screen.deleted',
        metadata: expect.objectContaining({ unpairedDeviceId: null }),
      }),
    );
  });

  it('records which device was unpaired in the audit trail', async () => {
    const t = build();
    await t.service.remove('c1', actor, 's1');
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ unpairedDeviceId: 'dev-1' }) }),
    );
  });

  it('refuses to delete a screen belonging to another tenant', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(null);
    await expect(t.service.remove('c1', actor, 'other')).rejects.toBeInstanceOf(NotFoundException);
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
  });
});
