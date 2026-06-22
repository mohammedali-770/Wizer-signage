import { BadRequestException } from '@nestjs/common';

import { EmergencyBroadcastService } from './emergency-broadcast.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ACTOR = { userId: 'u1', companyId: 'comp1', role: 'COMPANY_ADMIN' } as any;

function index(
  screens: any[] = [{ id: 's1', locationId: 'loc1', orientation: 'LANDSCAPE', groupIds: [] }],
) {
  const byId = new Map(screens.map((s) => [s.id, s]));
  const byLocation = new Map<string, string[]>();
  const byGroup = new Map<string, string[]>();
  for (const s of screens) {
    if (s.locationId)
      (byLocation.get(s.locationId) ?? byLocation.set(s.locationId, []).get(s.locationId)!).push(
        s.id,
      );
    for (const g of s.groupIds) (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(s.id);
  }
  return { allScreenIds: screens.map((s) => s.id), byId, byLocation, byGroup };
}

function build() {
  const prisma: any = {
    content: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ status: 'ACTIVE', expiresAt: null, orientation: 'LANDSCAPE' }),
    },
    playlist: { findFirst: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    playlistItem: { findMany: jest.fn().mockResolvedValue([]) },
    screen: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }]) },
    screenGroup: { findMany: jest.fn().mockResolvedValue([]) },
    location: { findMany: jest.fn().mockResolvedValue([]) },
    emergencyBroadcast: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    emergencyBroadcastTarget: { upsert: jest.fn(), delete: jest.fn() },
    $transaction: (ops: Promise<any>[]) => Promise.all(ops),
  };
  prisma.emergencyBroadcast.create.mockImplementation(({ data }: any) =>
    Promise.resolve(
      row({
        ...data,
        targets: (data.targets?.create ?? []).map((t: any, i: number) => ({
          id: `t${i}`,
          broadcastId: 'eb1',
          ...t,
        })),
      }),
    ),
  );
  prisma.emergencyBroadcast.update.mockImplementation(({ data }: any) =>
    Promise.resolve(row({ ...lastFindFirst, ...data })),
  );
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const schedules = { buildScreenIndex: jest.fn().mockResolvedValue(index()) };
  const commands = { dispatchToScreens: jest.fn().mockResolvedValue(1) };
  const alerts = {
    raise: jest.fn().mockResolvedValue({ alertId: 'a1', created: true }),
    resolveByKey: jest.fn().mockResolvedValue(0),
  };
  const service = new EmergencyBroadcastService(
    prisma,
    activityLog as any,
    schedules as any,
    commands as any,
    alerts as any,
  );
  return { service, prisma, activityLog, schedules, commands, alerts };
}

let lastFindFirst: any = {};
function row(over: any = {}) {
  const r = {
    id: 'eb1',
    companyId: 'comp1',
    title: 'Alert',
    description: null,
    broadcastType: 'TEXT',
    message: 'Evacuate now',
    url: null,
    contentId: null,
    playlistId: null,
    priority: 100,
    status: 'DRAFT',
    startAt: null,
    endAt: null,
    stoppedAt: null,
    createdById: 'u1',
    updatedById: 'u1',
    createdAt: new Date('2026-06-15T00:00:00Z'),
    updatedAt: new Date('2026-06-15T00:00:00Z'),
    targets: [{ id: 't0', broadcastId: 'eb1', targetType: 'SCREEN', targetId: 's1' }],
    ...over,
  };
  lastFindFirst = r;
  return r;
}

describe('EmergencyBroadcastService create/validate', () => {
  it('creates a CONTENT broadcast as DRAFT and logs it', async () => {
    const t = build();
    const out = await t.service.create('comp1', ACTOR, {
      title: 'Fire',
      broadcastType: 'CONTENT' as any,
      contentId: 'c1',
      targets: [{ targetType: 'SCREEN' as any, targetId: 's1' }],
    });
    expect(out.status).toBe('DRAFT');
    expect(out.contentId).toBe('c1');
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'emergency.created', category: 'EMERGENCY' }),
    );
  });

  it('creates a TEXT broadcast', async () => {
    const t = build();
    const out = await t.service.create('comp1', ACTOR, {
      title: 'Alert',
      broadcastType: 'TEXT' as any,
      message: 'Evacuate',
    });
    expect(out.broadcastType).toBe('TEXT');
  });

  it('rejects CONTENT that is not ACTIVE', async () => {
    const t = build();
    t.prisma.content.findFirst.mockResolvedValue({
      status: 'ARCHIVED',
      expiresAt: null,
      orientation: 'LANDSCAPE',
    });
    await expect(
      t.service.create('comp1', ACTOR, {
        title: 'x',
        broadcastType: 'CONTENT' as any,
        contentId: 'c1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects targeting a screen in another company', async () => {
    const t = build();
    t.prisma.screen.findMany.mockResolvedValue([]); // foreign screen not found in company
    await expect(
      t.service.create('comp1', ACTOR, {
        title: 'x',
        broadcastType: 'TEXT' as any,
        message: 'hi',
        targets: [{ targetType: 'SCREEN' as any, targetId: 's-foreign' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validate reports orientation mismatch as a warning, not an error', async () => {
    const t = build();
    t.prisma.emergencyBroadcast.findFirst.mockResolvedValue(
      row({ broadcastType: 'CONTENT', contentId: 'c1', message: null }),
    );
    t.prisma.content.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      expiresAt: null,
      orientation: 'PORTRAIT',
    });
    const v = await t.service.validate('comp1', 'eb1');
    expect(v.errors).toHaveLength(0);
    expect(v.valid).toBe(true);
    expect(v.affectedScreens).toBe(1);
    expect(v.warnings.join(' ')).toMatch(/portrait/i);
  });
});

describe('EmergencyBroadcastService lifecycle', () => {
  it('activate sets ACTIVE and fans out a refresh command', async () => {
    const t = build();
    t.prisma.emergencyBroadcast.findFirst.mockResolvedValue(row({ status: 'DRAFT' }));
    const out = await t.service.activate('comp1', ACTOR, 'eb1');
    expect(out.status).toBe('ACTIVE');
    expect(t.commands.dispatchToScreens).toHaveBeenCalledWith(
      'comp1',
      ['s1'],
      'REFRESH_MANIFEST',
      expect.any(Object),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'emergency.activated' }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'emergency.refresh_dispatched' }),
    );
  });

  it('activate refuses when there are no targets', async () => {
    const t = build();
    t.prisma.emergencyBroadcast.findFirst.mockResolvedValue(row({ status: 'DRAFT', targets: [] }));
    await expect(t.service.activate('comp1', ACTOR, 'eb1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(t.commands.dispatchToScreens).not.toHaveBeenCalled();
  });

  it('activate refuses an already-ended broadcast', async () => {
    const t = build();
    t.prisma.emergencyBroadcast.findFirst.mockResolvedValue(row({ status: 'ENDED' }));
    await expect(t.service.activate('comp1', ACTOR, 'eb1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('end marks ENDED and refreshes screens so they revert to schedule', async () => {
    const t = build();
    t.prisma.emergencyBroadcast.findFirst.mockResolvedValue(row({ status: 'ACTIVE' }));
    const out = await t.service.end('comp1', ACTOR, 'eb1');
    expect(out.status).toBe('ENDED');
    expect(t.commands.dispatchToScreens).toHaveBeenCalled();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'emergency.ended' }),
    );
  });

  it('endExpired auto-ends broadcasts past their endAt, dispatches refresh, and logs (Phase 10)', async () => {
    const t = build();
    t.prisma.emergencyBroadcast.findMany.mockResolvedValue([
      { id: 'eb1', companyId: 'comp1', createdById: 'u1' },
    ]);
    t.prisma.emergencyBroadcast.findFirst.mockResolvedValue(row({ status: 'ACTIVE' }));
    const ended = await t.service.endExpired(new Date());
    expect(ended).toEqual(['eb1']);
    expect(t.commands.dispatchToScreens).toHaveBeenCalled();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'emergency.auto_ended' }),
    );
  });

  it('quickText creates an ACTIVE text broadcast and dispatches', async () => {
    const t = build();
    const out = await t.service.quickText('comp1', ACTOR, {
      title: 'Evacuate',
      message: 'Leave the building',
      targets: [{ targetType: 'SCREEN' as any, targetId: 's1' }],
    });
    expect(out.status).toBe('ACTIVE');
    expect(out.broadcastType).toBe('TEXT');
    expect(t.commands.dispatchToScreens).toHaveBeenCalledWith(
      'comp1',
      ['s1'],
      'REFRESH_MANIFEST',
      expect.any(Object),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'emergency.quick_text' }),
    );
  });
});
