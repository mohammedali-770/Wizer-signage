import { ScheduleResolverService } from './schedule-resolver.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AT = new Date('2026-06-15T12:00:00Z'); // Monday 12:00 UTC

function screen(over: any = {}) {
  return {
    id: 's1',
    companyId: 'comp1',
    status: 'ONLINE',
    orientation: 'LANDSCAPE',
    locationId: 'loc1',
    workingHours: null,
    fallbackContentId: null,
    location: { timezone: 'UTC', workingHours: null, fallbackContentId: null },
    groups: [],
    ...over,
  };
}

function content(over: any = {}) {
  return {
    id: 'c1',
    type: 'IMAGE',
    title: 'Banner',
    orientation: 'LANDSCAPE',
    status: 'ACTIVE',
    expiresAt: null,
    deletedAt: null,
    durationSeconds: 10,
    pageCount: null,
    mimeType: 'image/png',
    fileSize: BigInt(1000),
    checksum: 'sha',
    storageKey: 'companies/comp1/content/c1/banner.png',
    url: null,
    textBody: null,
    updatedAt: new Date('2026-06-16T00:00:00Z'),
    ...over,
  };
}

function schedule(over: any = {}) {
  return {
    id: 'sch1',
    name: 'Promo',
    priority: 0,
    scheduleType: 'NORMAL',
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    startDate: new Date('2026-06-01T00:00:00Z'),
    endDate: null,
    startTime: null,
    endTime: null,
    isAllDay: true,
    daysOfWeek: [],
    timezone: null,
    status: 'ACTIVE',
    playlistId: 'pl1',
    playlist: { id: 'pl1', title: 'Promo', status: 'ACTIVE' },
    targets: [{ id: 't', targetType: 'COMPANY', targetId: 'comp1' }],
    ...over,
  };
}

function build() {
  const prisma: any = {
    screen: { findFirst: jest.fn().mockResolvedValue(screen()) },
    company: {
      findFirst: jest.fn().mockResolvedValue({
        timezone: 'UTC',
        settings: {},
        fallbackContentId: null,
        status: 'ACTIVE',
      }),
    },
    schedule: { findMany: jest.fn().mockResolvedValue([]) },
    emergencyBroadcast: { findMany: jest.fn().mockResolvedValue([]) },
    playlistItem: {
      findMany: jest.fn().mockResolvedValue([
        {
          contentId: 'c1',
          durationSeconds: null,
          playFullVideo: false,
          pdfPageDurationSeconds: null,
          content: content(),
        },
      ]),
    },
    content: { findFirst: jest.fn().mockResolvedValue(content()) },
  };
  const storage = { getSignedUrl: jest.fn().mockResolvedValue('https://signed/url') };
  const service = new ScheduleResolverService(prisma, storage as any);
  return { service, prisma, storage };
}

describe('ScheduleResolverService.resolve', () => {
  it('returns a SCHEDULE manifest with signed URLs for a valid match', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([schedule()]);
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.sourceType).toBe('SCHEDULE');
    expect(manifest.scheduleId).toBe('sch1');
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]!.signedUrl).toBe('https://signed/url');
    expect(manifest.items[0]!.fileSizeBytes).toBe('1000'); // BigInt serialized
  });

  it('falls back to the screen fallback content when no schedule matches', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(screen({ fallbackContentId: 'fb1' }));
    t.prisma.content.findFirst.mockResolvedValue(content({ id: 'fb1' }));
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.sourceType).toBe('FALLBACK');
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]!.contentId).toBe('fb1');
  });

  it('returns NONE with no fallback configured', async () => {
    const t = build();
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.sourceType).toBe('NONE');
    expect(manifest.items).toHaveLength(0);
    expect(manifest.warnings.join(' ')).toMatch(/no fallback/i);
  });

  it('skips invalid content but keeps valid items', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([schedule()]);
    t.prisma.playlistItem.findMany.mockResolvedValue([
      {
        contentId: 'bad',
        durationSeconds: null,
        playFullVideo: false,
        pdfPageDurationSeconds: null,
        content: content({ id: 'bad', status: 'ARCHIVED' }),
      },
      {
        contentId: 'good',
        durationSeconds: null,
        playFullVideo: false,
        pdfPageDurationSeconds: null,
        content: content({ id: 'good' }),
      },
    ]);
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]!.contentId).toBe('good');
    expect(manifest.warnings.join(' ')).toMatch(/skipped/i);
  });

  it('honors outside-hours BLACK_SCREEN behavior', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(
      screen({
        workingHours: { days: [{ day: 1, closed: true }], outsideHoursBehavior: 'BLACK_SCREEN' },
      }),
    );
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.outsideHours).toBe(true);
    expect(manifest.outsideHoursBehavior).toBe('BLACK_SCREEN');
    expect(manifest.sourceType).toBe('NONE');
  });

  it('resolves the highest-priority matching schedule', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([
      schedule({
        id: 'low',
        priority: 1,
        playlistId: 'plLow',
        playlist: { id: 'plLow', title: 'Low', status: 'ACTIVE' },
      }),
      schedule({
        id: 'high',
        priority: 10,
        playlistId: 'plHigh',
        playlist: { id: 'plHigh', title: 'High', status: 'ACTIVE' },
      }),
    ]);
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.scheduleId).toBe('high');
    expect(manifest.playlistId).toBe('plHigh');
  });

  it('ignores per-item duration for a full-play video (uses content length)', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([schedule()]);
    t.prisma.playlistItem.findMany.mockResolvedValue([
      {
        contentId: 'v1',
        durationSeconds: 30, // should be ignored when playFullVideo is true
        playFullVideo: true,
        pdfPageDurationSeconds: null,
        content: content({ id: 'v1', type: 'VIDEO', durationSeconds: 120, mimeType: 'video/mp4' }),
      },
    ]);
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.items[0]!.playFullVideo).toBe(true);
    expect(manifest.items[0]!.durationSeconds).toBe(120);
  });

  it('skips a schedule whose playlist is archived/soft-deleted', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([
      schedule({ playlist: { id: 'pl1', title: 'Promo', status: 'ARCHIVED', deletedAt: null } }),
    ]);
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.sourceType).toBe('NONE'); // no fallback configured
  });

  it('serves nothing when the company is suspended', async () => {
    const t = build();
    t.prisma.company.findFirst.mockResolvedValue({
      timezone: 'UTC',
      settings: {},
      fallbackContentId: null,
      status: 'SUSPENDED',
    });
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.sourceType).toBe('NONE');
    expect(manifest.warnings.join(' ')).toMatch(/suspended/i);
  });
});

function broadcast(over: any = {}) {
  return {
    id: 'eb1',
    broadcastType: 'CONTENT',
    contentId: 'c1',
    playlistId: null,
    message: null,
    url: null,
    priority: 100,
    status: 'ACTIVE',
    startAt: null,
    endAt: null,
    updatedAt: new Date('2026-06-14T00:00:00Z'),
    targets: [{ id: 't', targetType: 'COMPANY', targetId: 'comp1' }],
    ...over,
  };
}

describe('ScheduleResolverService emergency pre-emption (Phase 9)', () => {
  it('an active emergency overrides a matching schedule', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([schedule()]);
    t.prisma.emergencyBroadcast.findMany.mockResolvedValue([broadcast()]);
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.sourceType).toBe('EMERGENCY');
    expect(manifest.emergencyBroadcastId).toBe('eb1');
    expect(manifest.items).toHaveLength(1);
  });

  it('the highest-priority emergency wins a tie of matches', async () => {
    const t = build();
    t.prisma.emergencyBroadcast.findMany.mockResolvedValue([
      broadcast({ id: 'low', priority: 5 }),
      broadcast({ id: 'high', priority: 50 }),
    ]);
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.emergencyBroadcastId).toBe('high');
  });

  it('overrides working hours (emergency plays even when closed)', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(
      screen({
        workingHours: {
          days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, closed: true })),
          outsideHoursBehavior: 'BLACK_SCREEN',
        },
      }),
    );
    t.prisma.emergencyBroadcast.findMany.mockResolvedValue([broadcast()]);
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.sourceType).toBe('EMERGENCY');
  });

  it('builds a TEXT emergency with the message and no library content', async () => {
    const t = build();
    t.prisma.emergencyBroadcast.findMany.mockResolvedValue([
      broadcast({ broadcastType: 'TEXT', contentId: null, message: 'Evacuate now' }),
    ]);
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.sourceType).toBe('EMERGENCY');
    expect(manifest.message).toBe('Evacuate now');
    expect(manifest.items[0]!.type).toBe('TEXT');
    expect(manifest.items[0]!.textBody).toBe('Evacuate now');
    expect(manifest.items[0]!.contentId).toMatch(/^emg:/);
  });

  it('skips an emergency whose content is not playable and falls through to schedule', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([schedule()]);
    t.prisma.emergencyBroadcast.findMany.mockResolvedValue([broadcast({ contentId: 'gone' })]);
    t.prisma.content.findFirst.mockResolvedValue(null); // emergency content missing
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.sourceType).toBe('SCHEDULE');
  });

  it('returns to the schedule once the emergency has ended (none active)', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([schedule()]);
    t.prisma.emergencyBroadcast.findMany.mockResolvedValue([]); // ended → not returned by the ACTIVE query
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.sourceType).toBe('SCHEDULE');
  });
});

describe('ScheduleResolverService manifest hash (Req 6)', () => {
  it('stamps a 64-char sha256 manifestHash on the manifest', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([schedule()]);
    const manifest = await t.service.resolve('comp1', 's1', AT);
    expect(manifest.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across re-resolves of unchanged config (ignores generatedAt)', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([schedule()]);
    const a = await t.service.resolve('comp1', 's1', new Date('2026-06-15T12:00:00Z'));
    const b = await t.service.resolve('comp1', 's1', new Date('2026-06-15T12:30:00Z'));
    expect(a.generatedAt).not.toEqual(b.generatedAt); // volatile field differs
    expect(a.manifestHash).toBe(b.manifestHash); // content fingerprint stays the same
  });

  it('changes when the played content version (updatedAt) changes', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([schedule()]);
    const before = await t.service.resolve('comp1', 's1', AT);
    t.prisma.playlistItem.findMany.mockResolvedValue([
      {
        contentId: 'c1',
        durationSeconds: null,
        playFullVideo: false,
        pdfPageDurationSeconds: null,
        content: content({ updatedAt: new Date('2026-06-17T00:00:00Z') }),
      },
    ]);
    const after = await t.service.resolve('comp1', 's1', AT);
    expect(after.manifestHash).not.toBe(before.manifestHash);
  });

  it('differs between a SCHEDULE manifest and an empty NONE manifest', async () => {
    const scheduled = build();
    scheduled.prisma.schedule.findMany.mockResolvedValue([schedule()]);
    const withSchedule = await scheduled.service.resolve('comp1', 's1', AT);
    const empty = build(); // no schedule → NONE
    const none = await empty.service.resolve('comp1', 's1', AT);
    expect(withSchedule.manifestHash).not.toBe(none.manifestHash);
  });
});
