import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { LocationsService } from './locations.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    location: {
      create: jest
        .fn()
        .mockImplementation(({ data }: any) => Promise.resolve({ id: 'l1', ...data })),
      findFirst: jest.fn(),
      update: jest
        .fn()
        .mockImplementation(({ data }: any) => Promise.resolve({ id: 'l1', ...data })),
    },
    screen: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const usageLimits = { assertCanAdd: jest.fn().mockResolvedValue(undefined) };
  const service = new LocationsService(prisma, activityLog as any, usageLimits as any);
  return { service, prisma, activityLog, usageLimits };
}

const actor: any = { userId: 'u1', isSuperAdmin: false, companyId: 'c1', role: 'COMPANY_ADMIN' };

describe('LocationsService.create', () => {
  it('enforces the location plan limit and logs creation', async () => {
    const t = build();
    await t.service.create('c1', actor, { name: 'Main Branch' });
    expect(t.usageLimits.assertCanAdd).toHaveBeenCalledWith('c1', 'locations');
    expect(t.prisma.location.create).toHaveBeenCalled();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'location.created' }),
    );
  });

  it('blocks creation when the limit/grace check rejects', async () => {
    const t = build();
    t.usageLimits.assertCanAdd.mockRejectedValue(new ForbiddenException('limit reached'));
    await expect(t.service.create('c1', actor, { name: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(t.prisma.location.create).not.toHaveBeenCalled();
  });
});

describe('LocationsService company scoping', () => {
  it('returns 404 for a location outside the tenant', async () => {
    const t = build();
    t.prisma.location.findFirst.mockResolvedValue(null);
    await expect(t.service.getScopedOrThrow('c1', 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(t.prisma.location.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'c1' }) }),
    );
  });
});

describe('LocationsService.setStatus', () => {
  it('archives and reactivates with the right audit action', async () => {
    const t = build();
    t.prisma.location.findFirst.mockResolvedValue({ id: 'l1', companyId: 'c1', status: 'ACTIVE' });

    await t.service.setStatus('c1', actor, 'l1', 'ARCHIVED' as any);
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'location.archived' }),
    );

    await t.service.setStatus('c1', actor, 'l1', 'ACTIVE' as any);
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'location.reactivated' }),
    );
  });

  it('re-checks the plan limit when reactivating an ARCHIVED location and blocks when exceeded', async () => {
    const t = build();
    t.prisma.location.findFirst.mockResolvedValue({
      id: 'l1',
      companyId: 'c1',
      status: 'ARCHIVED',
    });
    t.usageLimits.assertCanAdd.mockRejectedValue(new ForbiddenException('limit reached'));
    await expect(t.service.setStatus('c1', actor, 'l1', 'ACTIVE' as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(t.usageLimits.assertCanAdd).toHaveBeenCalledWith('c1', 'locations');
    expect(t.prisma.location.update).not.toHaveBeenCalled();
  });
});
