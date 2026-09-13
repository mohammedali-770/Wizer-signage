import { NotFoundException } from '@nestjs/common';

import { DeviceContentService } from './device-content.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const device: any = { id: 'd1', deviceId: 'dev1', screenId: 's1', companyId: 'comp1' };
const res: any = {
  setHeader: jest.fn(),
  status: jest.fn().mockReturnThis(),
  end: jest.fn(),
  send: jest.fn(),
};

function content(over: any = {}) {
  return {
    id: 'c1',
    type: 'IMAGE',
    title: 'Banner',
    orientation: 'LANDSCAPE',
    status: 'ACTIVE',
    expiresAt: null,
    durationSeconds: 10,
    pageCount: null,
    mimeType: 'image/png',
    fileSize: BigInt(1000),
    checksum: 'sha',
    storageKey: 'companies/comp1/content/c1/f.png',
    url: null,
    textBody: null,
    updatedAt: new Date('2026-06-16T00:00:00Z'),
    ...over,
  };
}

function schedule(over: any = {}) {
  return {
    id: 'sch1',
    name: 'All day',
    priority: 0,
    scheduleType: 'NORMAL',
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: null,
    startTime: null,
    endTime: null,
    isAllDay: true,
    daysOfWeek: [],
    timezone: null,
    playlistId: 'pl1',
    playlist: { id: 'pl1', status: 'ACTIVE', deletedAt: null },
    targets: [{ id: 't', targetType: 'COMPANY', targetId: 'comp1' }],
    ...over,
  };
}

function build() {
  const prisma: any = {
    screen: {
      findFirst: jest.fn().mockResolvedValue({
        id: 's1',
        companyId: 'comp1',
        locationId: 'loc1',
        orientation: 'LANDSCAPE',
        workingHours: null,
        fallbackContentId: null,
        location: { timezone: 'UTC', workingHours: null, fallbackContentId: null },
        company: { timezone: 'UTC' },
        groups: [],
      }),
    },
    schedule: { findMany: jest.fn().mockResolvedValue([]) },
    playlistItem: { findMany: jest.fn().mockResolvedValue([]) },
    content: { findMany: jest.fn().mockResolvedValue([]) },
    company: { findFirst: jest.fn().mockResolvedValue({ fallbackContentId: null }) },
  };
  const storage = {
    streamContent: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn().mockResolvedValue('https://storage.example.invalid/signed/obj'),
  };
  const service = new DeviceContentService(prisma as any, storage as any);
  return { service, prisma, storage };
}

describe('DeviceContentService entitlement scoping', () => {
  it('only ever loads the device’s own screen (token-scoped)', async () => {
    const t = build();
    await t.service.getSyncPlan(device);
    expect(t.prisma.screen.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 's1', companyId: 'comp1', deletedAt: null }),
      }),
    );
  });

  it('content is always filtered to the company + ACTIVE + non-expired', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue({
      id: 's1',
      companyId: 'comp1',
      locationId: 'loc1',
      orientation: 'LANDSCAPE',
      workingHours: null,
      fallbackContentId: 'fb1',
      location: { timezone: 'UTC', workingHours: null, fallbackContentId: null },
      company: { timezone: 'UTC' },
      groups: [],
    });
    t.prisma.content.findMany.mockResolvedValue([content({ id: 'fb1' })]);
    await t.service.getSyncPlan(device);
    expect(t.prisma.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'comp1',
          deletedAt: null,
          status: 'ACTIVE',
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        }),
      }),
    );
  });
});

describe('DeviceContentService entitlement cache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reuses one entitlement computation for repeated requests in the same minute', async () => {
    const t = build();
    jest.spyOn(Date, 'now').mockReturnValue(1_725_000_000_000);

    await t.service.getSyncPlan(device);
    await t.service.getSyncPlan(device);

    expect(t.prisma.screen.findFirst).toHaveBeenCalledTimes(1);
    expect(t.prisma.schedule.findMany).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent requests onto the same in-flight entitlement promise', async () => {
    const t = build();
    jest.spyOn(Date, 'now').mockReturnValue(1_725_000_000_000);
    let resolveScreen!: (value: any) => void;
    const screenPromise = new Promise<any>((resolve) => {
      resolveScreen = resolve;
    });
    t.prisma.screen.findFirst.mockReturnValue(screenPromise);

    const first = t.service.getSyncPlan(device);
    const second = t.service.getSyncPlan(device);

    expect(t.prisma.screen.findFirst).toHaveBeenCalledTimes(1);
    resolveScreen({
      id: 's1',
      companyId: 'comp1',
      locationId: 'loc1',
      orientation: 'LANDSCAPE',
      workingHours: null,
      fallbackContentId: null,
      location: { timezone: 'UTC', workingHours: null, fallbackContentId: null },
      company: { timezone: 'UTC' },
      groups: [],
    });

    await Promise.all([first, second]);
    expect(t.prisma.schedule.findMany).toHaveBeenCalledTimes(1);
  });

  it('evicts a failed computation so a retry in the same minute recomputes', async () => {
    const t = build();
    jest.spyOn(Date, 'now').mockReturnValue(1_725_000_000_000);
    t.prisma.screen.findFirst
      .mockRejectedValueOnce(new Error('temporary database failure'))
      .mockResolvedValueOnce({
        id: 's1',
        companyId: 'comp1',
        locationId: 'loc1',
        orientation: 'LANDSCAPE',
        workingHours: null,
        fallbackContentId: null,
        location: { timezone: 'UTC', workingHours: null, fallbackContentId: null },
        company: { timezone: 'UTC' },
        groups: [],
      });

    await expect(t.service.getSyncPlan(device)).rejects.toThrow('temporary database failure');
    await expect(t.service.getSyncPlan(device)).resolves.toEqual(
      expect.objectContaining({ screenId: 's1' }),
    );
    expect(t.prisma.screen.findFirst).toHaveBeenCalledTimes(2);
  });

  it('recomputes when the minute bucket changes', async () => {
    const t = build();
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_725_000_000_000);
    await t.service.getSyncPlan(device);
    now.mockReturnValue(1_725_000_061_000);
    await t.service.getSyncPlan(device);

    expect(t.prisma.screen.findFirst).toHaveBeenCalledTimes(2);
    expect(t.prisma.schedule.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('DeviceContentService.getSyncPlan', () => {
  it('includes fallback assets with a download path', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue({
      id: 's1',
      companyId: 'comp1',
      locationId: 'loc1',
      orientation: 'LANDSCAPE',
      workingHours: null,
      fallbackContentId: 'fb1',
      location: { timezone: 'UTC', workingHours: null, fallbackContentId: null },
      company: { timezone: 'UTC' },
      groups: [],
    });
    t.prisma.content.findMany.mockResolvedValue([content({ id: 'fb1' })]);
    const plan = await t.service.getSyncPlan(device);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.downloadPath).toBe('/device/content/fb1/download');
    expect(plan.preDownloadWindowSeconds).toBe(3600);
  });

  it('includes assets from upcoming schedules within the window', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([schedule()]);
    t.prisma.playlistItem.findMany.mockResolvedValue([{ contentId: 'c1' }]);
    t.prisma.content.findMany.mockResolvedValue([content({ id: 'c1', type: 'VIDEO' })]);
    const plan = await t.service.getSyncPlan(device);
    expect(t.prisma.playlistItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { playlistId: { in: ['pl1'] } } }),
    );
    expect(plan.items.map((i) => i.contentId)).toContain('c1');
  });

  it('excludes invalid content (content query returns nothing for it)', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([schedule()]);
    t.prisma.playlistItem.findMany.mockResolvedValue([{ contentId: 'expired' }]);
    t.prisma.content.findMany.mockResolvedValue([]);
    const plan = await t.service.getSyncPlan(device);
    expect(plan.items).toHaveLength(0);
  });

  it('excludes content from DRAFT playlists (only ACTIVE plays/caches)', async () => {
    const t = build();
    t.prisma.schedule.findMany.mockResolvedValue([
      schedule({ playlist: { id: 'pl1', status: 'DRAFT', deletedAt: null } }),
    ]);
    t.prisma.playlistItem.findMany.mockResolvedValue([{ contentId: 'c1' }]);
    t.prisma.content.findMany.mockResolvedValue([content({ id: 'c1' })]);
    const plan = await t.service.getSyncPlan(device);
    expect(t.prisma.playlistItem.findMany).not.toHaveBeenCalled();
    expect(plan.items).toHaveLength(0);
  });
});

describe('DeviceContentService.download entitlement', () => {
  it('streams an entitled file', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue({
      id: 's1',
      companyId: 'comp1',
      locationId: 'loc1',
      orientation: 'LANDSCAPE',
      workingHours: null,
      fallbackContentId: 'c1',
      location: { timezone: 'UTC', workingHours: null, fallbackContentId: null },
      company: { timezone: 'UTC' },
      groups: [],
    });
    t.prisma.content.findMany.mockResolvedValue([content({ id: 'c1' })]);
    await t.service.download(device, 'c1', undefined, res);
    expect(t.storage.streamContent).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'companies/comp1/content/c1/f.png', mimeType: 'image/png' }),
    );
  });

  it('rejects a content id not entitled to this screen (404)', async () => {
    const t = build();
    t.prisma.content.findMany.mockResolvedValue([]);
    await expect(t.service.download(device, 'arbitrary', undefined, res)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(t.storage.streamContent).not.toHaveBeenCalled();
  });

  it('rejects URL/TEXT (non-file) content even if entitled', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue({
      id: 's1',
      companyId: 'comp1',
      locationId: 'loc1',
      orientation: 'LANDSCAPE',
      workingHours: null,
      fallbackContentId: 'u1',
      location: { timezone: 'UTC', workingHours: null, fallbackContentId: null },
      company: { timezone: 'UTC' },
      groups: [],
    });
    t.prisma.content.findMany.mockResolvedValue([
      content({ id: 'u1', type: 'URL', storageKey: null, url: 'https://x' }),
    ]);
    await expect(t.service.download(device, 'u1', undefined, res)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(t.storage.streamContent).not.toHaveBeenCalled();
  });

  /**
   * Taking media delivery off the droplet.
   *
   * Every cached byte is currently proxied through the API (storage.service.ts
   * streamContent), which makes this one container the bandwidth bottleneck for
   * the entire fleet. The sync plan now also carries a direct storage URL so a
   * player can fetch the asset itself.
   *
   * The load-bearing property is that this is ADDITIVE: `downloadPath` must
   * survive untouched, or every player already in the field stops caching.
   */
  /** A screen whose fallback content is `id` — the minimum arrangement that puts one item in the plan. */
  const planWith = (
    t: ReturnType<typeof build>,
    id: string,
    over: Record<string, unknown> = {},
  ) => {
    t.prisma.screen.findFirst.mockResolvedValue({
      id: 's1',
      companyId: 'comp1',
      locationId: 'loc1',
      orientation: 'LANDSCAPE',
      workingHours: null,
      fallbackContentId: id,
      location: { timezone: 'UTC', workingHours: null, fallbackContentId: null },
      company: { timezone: 'UTC' },
      groups: [],
    });
    t.prisma.content.findMany.mockResolvedValue([content({ id, ...over })]);
  };

  describe('getSyncPlan direct-download URLs', () => {
    it('carries a direct signedUrl for file content', async () => {
      const t = build();
      planWith(t, 'c1', { type: 'IMAGE' });
      const plan = await t.service.getSyncPlan(device);
      const item = plan.items.find((i: { contentId: string }) => i.contentId === 'c1');
      expect(item?.signedUrl).toBe('https://storage.example.invalid/signed/obj');
    });

    it('KEEPS downloadPath so players already in the field are unaffected', async () => {
      const t = build();
      planWith(t, 'c1', { type: 'IMAGE' });
      const plan = await t.service.getSyncPlan(device);
      const item = plan.items.find((i: { contentId: string }) => i.contentId === 'c1');
      expect(item?.downloadPath).toBe('/device/content/c1/download');
    });

    it('signs with the same TTL the manifest uses, so both share cache entries', async () => {
      const t = build();
      planWith(t, 'c1', { type: 'IMAGE' });
      await t.service.getSyncPlan(device);
      // 3600 === MANIFEST_SIGNED_TTL_SECONDS. A different value would silently
      // double the signing rate against Storage rather than reuse the cache.
      expect(t.storage.getSignedUrl).toHaveBeenCalledWith(
        'companies/comp1/content/c1/f.png',
        expect.any(String),
        3600,
      );
    });

    it('does not sign non-file content', async () => {
      const t = build();
      planWith(t, 'u1', { type: 'URL', storageKey: null, url: 'https://x' });
      const plan = await t.service.getSyncPlan(device);
      const item = plan.items.find((i: { contentId: string }) => i.contentId === 'u1');
      expect(item?.signedUrl).toBeNull();
      expect(t.storage.getSignedUrl).not.toHaveBeenCalled();
    });

    it('still returns a usable plan when signing fails', async () => {
      const t = build();
      t.storage.getSignedUrl.mockRejectedValue(new Error('storage down'));
      planWith(t, 'c1', { type: 'IMAGE' });
      const plan = await t.service.getSyncPlan(device);
      const item = plan.items.find((i: { contentId: string }) => i.contentId === 'c1');
      // Degrades to the proxied path rather than failing the whole sync plan --
      // a signing outage must not stop the fleet from caching.
      expect(item?.signedUrl).toBeNull();
      expect(item?.downloadPath).toBe('/device/content/c1/download');
    });
  });
});
