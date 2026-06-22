import { BadRequestException } from '@nestjs/common';

import { ScreenGroupsService } from './screen-groups.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    screenGroup: {
      findFirst: jest.fn().mockResolvedValue({ id: 'g1', companyId: 'c1', name: 'G' }),
    },
    screenGroupMember: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    screen: { findMany: jest.fn() },
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new ScreenGroupsService(prisma, activityLog as any);
  return { service, prisma, activityLog };
}

const actor: any = { userId: 'u1', isSuperAdmin: false, companyId: 'c1', role: 'COMPANY_ADMIN' };

describe('ScreenGroupsService membership', () => {
  it('adds screens after validating they belong to the company, and logs', async () => {
    const t = build();
    t.prisma.screen.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    await t.service.addScreens('c1', actor, 'g1', ['s1', 's2']);
    expect(t.prisma.screenGroupMember.createMany).toHaveBeenCalled();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'screen_group.screens_added' }),
    );
  });

  it('rejects adding a screen from another company', async () => {
    const t = build();
    t.prisma.screen.findMany.mockResolvedValue([{ id: 's1' }]); // 1 of 2 valid
    await expect(t.service.addScreens('c1', actor, 'g1', ['s1', 'foreign'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('removes screens and logs', async () => {
    const t = build();
    await t.service.removeScreens('c1', actor, 'g1', ['s1']);
    expect(t.prisma.screenGroupMember.deleteMany).toHaveBeenCalledWith({
      where: { groupId: 'g1', screenId: { in: ['s1'] } },
    });
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'screen_group.screens_removed' }),
    );
  });
});
