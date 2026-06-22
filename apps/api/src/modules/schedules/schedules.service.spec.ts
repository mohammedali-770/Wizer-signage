import { SchedulesService } from './schedules.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const actor: any = { userId: 'u1', companyId: 'comp1', role: 'COMPANY_ADMIN' };

function schedule(over: any = {}) {
  return {
    id: 'sch1',
    companyId: 'comp1',
    name: 'Lunch promo',
    description: null,
    playlistId: 'pl1',
    playlist: { id: 'pl1', title: 'Promo', status: 'ACTIVE' },
    status: 'ACTIVE',
    scheduleType: 'NORMAL',
    priority: 0,
    startDate: new Date('2026-06-01T00:00:00Z'),
    endDate: null,
    startTime: '09:00',
    endTime: '17:00',
    isAllDay: false,
    daysOfWeek: [],
    timezone: null,
    recurrence: null,
    createdById: 'u1',
    updatedById: 'u1',
    createdAt: new Date(),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    archivedAt: null,
    targets: [],
    ...over,
  };
}

function build() {
  const prisma: any = {
    schedule: {
      create: jest.fn().mockResolvedValue(schedule()),
      findFirst: jest
        .fn()
        .mockResolvedValue(
          schedule({ targets: [{ id: 't1', targetType: 'COMPANY', targetId: 'comp1' }] }),
        ),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(schedule(data))),
    },
    scheduleTarget: {
      upsert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    screen: {
      findFirst: jest.fn().mockResolvedValue({ id: 's1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    screenGroup: { findFirst: jest.fn().mockResolvedValue({ id: 'g1' }) },
    location: { findFirst: jest.fn().mockResolvedValue({ id: 'loc1' }) },
    screenGroupMember: { findMany: jest.fn().mockResolvedValue([]) },
  };
  prisma.$transaction = jest.fn((arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
  );
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const playlists = {
    validate: jest.fn().mockResolvedValue({ schedulable: true, validItemCount: 1 }),
    getScopedOrThrow: jest.fn().mockResolvedValue({ id: 'pl1' }),
    getDetail: jest.fn().mockResolvedValue({ orientationProfile: 'UNKNOWN' }),
  };
  const service = new SchedulesService(prisma, activityLog as any, playlists as any);
  return { service, prisma, activityLog, playlists };
}

describe('SchedulesService.create validation', () => {
  it('rejects endDate before startDate', async () => {
    const t = build();
    await expect(
      t.service.create('comp1', actor, {
        name: 'x',
        startDate: '2026-06-10',
        endDate: '2026-06-01',
        startTime: '09:00',
        endTime: '17:00',
      } as any),
    ).rejects.toThrow(/on or after/i);
  });

  it('requires start/end time unless all-day', async () => {
    const t = build();
    await expect(
      t.service.create('comp1', actor, { name: 'x', startDate: '2026-06-10' } as any),
    ).rejects.toThrow(/all-day/i);
  });

  it('cannot activate without a playlist', async () => {
    const t = build();
    await expect(
      t.service.create('comp1', actor, {
        name: 'x',
        startDate: '2026-06-10',
        isAllDay: true,
        status: 'ACTIVE',
      } as any),
    ).rejects.toThrow(/playlist/i);
  });

  it('rejects a target screen from another company', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(null);
    await expect(
      t.service.create('comp1', actor, {
        name: 'x',
        startDate: '2026-06-10',
        isAllDay: true,
        status: 'PAUSED',
        targets: [{ targetType: 'SCREEN', targetId: 'sX' }],
      } as any),
    ).rejects.toThrow(/not in this company/i);
  });

  it('creates a paused schedule and logs', async () => {
    const t = build();
    await t.service.create('comp1', actor, {
      name: 'x',
      startDate: '2026-06-10',
      isAllDay: true,
      status: 'PAUSED',
    } as any);
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'schedule.created' }),
    );
  });
});

describe('SchedulesService.setStatus', () => {
  it('blocks resume when the playlist has no valid items', async () => {
    const t = build();
    t.prisma.schedule.findFirst.mockResolvedValue(
      schedule({
        status: 'PAUSED',
        targets: [{ id: 't1', targetType: 'COMPANY', targetId: 'comp1' }],
      }),
    );
    t.playlists.validate.mockResolvedValue({ schedulable: false, validItemCount: 0 });
    await expect(t.service.setStatus('comp1', actor, 'sch1', 'ACTIVE' as any)).rejects.toThrow(
      /no valid items/i,
    );
  });
});

describe('SchedulesService.update', () => {
  it('blocks disconnecting the playlist from an ACTIVE schedule', async () => {
    const t = build();
    t.prisma.schedule.findFirst.mockResolvedValue(
      schedule({
        status: 'ACTIVE',
        playlistId: 'pl1',
        targets: [{ id: 't1', targetType: 'COMPANY', targetId: 'comp1' }],
      }),
    );
    await expect(
      t.service.update('comp1', actor, 'sch1', { playlistId: null } as any),
    ).rejects.toThrow(/playlist/i);
  });
});

describe('SchedulesService.conflicts', () => {
  const companyTargets = [{ id: 't', targetType: 'COMPANY', targetId: 'comp1' }];

  it('detects overlap between two company-wide schedules sharing a screen', async () => {
    const t = build();
    t.prisma.screen.findMany.mockResolvedValue([
      { id: 's1', locationId: 'locA', orientation: 'LANDSCAPE' },
    ]);
    t.prisma.schedule.findMany.mockResolvedValue([
      schedule({ id: 'a', startTime: '09:00', endTime: '12:00', targets: companyTargets }),
      schedule({ id: 'b', startTime: '11:00', endTime: '14:00', targets: companyTargets }),
    ]);
    const result = await t.service.conflicts('comp1');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.sharedScreenIds).toEqual(['s1']);
  });

  it('reports no conflict when schedules target different screens', async () => {
    const t = build();
    t.prisma.screen.findMany.mockResolvedValue([
      { id: 's1', locationId: 'locA', orientation: 'LANDSCAPE' },
      { id: 's2', locationId: 'locA', orientation: 'LANDSCAPE' },
    ]);
    t.prisma.schedule.findMany.mockResolvedValue([
      schedule({ id: 'a', targets: [{ id: 'x', targetType: 'SCREEN', targetId: 's1' }] }),
      schedule({ id: 'b', targets: [{ id: 'y', targetType: 'SCREEN', targetId: 's2' }] }),
    ]);
    const result = await t.service.conflicts('comp1');
    expect(result.conflicts).toHaveLength(0);
  });
});
