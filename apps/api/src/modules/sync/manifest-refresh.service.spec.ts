import { REFRESH_DEBOUNCE_MS, ManifestRefreshService } from './manifest-refresh.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    device: { findMany: jest.fn().mockResolvedValue([]) },
    deviceCommand: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const service = new ManifestRefreshService(prisma);
  return { service, prisma };
}

describe('ManifestRefreshService', () => {
  it('dispatches REFRESH_MANIFEST to every active-device screen when none are queued', async () => {
    const { service, prisma } = build();
    prisma.device.findMany.mockResolvedValue([
      { id: 'd1', screenId: 's1' },
      { id: 'd2', screenId: 's2' },
    ]);
    prisma.deviceCommand.createMany.mockResolvedValue({ count: 2 });

    const count = await service.refreshCompany('c1');

    expect(count).toBe(2);
    // Scoped to the company, only ACTIVE devices, non-deleted screens.
    expect(prisma.device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'c1', status: 'ACTIVE' }),
      }),
    );
    const arg = prisma.deviceCommand.createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(2);
    expect(arg.data[0]).toMatchObject({
      companyId: 'c1',
      screenId: 's1',
      deviceId: 'd1',
      commandType: 'REFRESH_MANIFEST',
      status: 'PENDING',
    });
    expect(arg.data[0].expiresAt).toBeInstanceOf(Date);
  });

  it('dedupes — skips screens that already have a PENDING refresh', async () => {
    const { service, prisma } = build();
    prisma.device.findMany.mockResolvedValue([
      { id: 'd1', screenId: 's1' },
      { id: 'd2', screenId: 's2' },
    ]);
    prisma.deviceCommand.findMany.mockResolvedValue([{ screenId: 's1' }]); // s1 queued
    prisma.deviceCommand.createMany.mockResolvedValue({ count: 1 });

    const count = await service.refreshCompany('c1');

    expect(count).toBe(1);
    const arg = prisma.deviceCommand.createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(1);
    expect(arg.data[0].screenId).toBe('s2');
  });

  it('creates nothing when there are no active devices', async () => {
    const { service, prisma } = build();
    prisma.device.findMany.mockResolvedValue([]);

    const count = await service.refreshCompany('c1');

    expect(count).toBe(0);
    expect(prisma.deviceCommand.createMany).not.toHaveBeenCalled();
  });

  it('creates nothing when every active device already has a pending refresh', async () => {
    const { service, prisma } = build();
    prisma.device.findMany.mockResolvedValue([{ id: 'd1', screenId: 's1' }]);
    prisma.deviceCommand.findMany.mockResolvedValue([{ screenId: 's1' }]);

    const count = await service.refreshCompany('c1');

    expect(count).toBe(0);
    expect(prisma.deviceCommand.createMany).not.toHaveBeenCalled();
  });

  it('is best-effort — never throws on a prisma error, returns 0', async () => {
    const { service, prisma } = build();
    prisma.device.findMany.mockRejectedValue(new Error('db down'));

    await expect(service.refreshCompany('c1')).resolves.toBe(0);
  });
});

/**
 * Debouncing.
 *
 * Editing is bursty — reordering a playlist, bulk-tagging content, saving a
 * schedule and immediately fixing it. Each write dispatched its own refresh, and
 * each dispatch reads every device and every pending command in the company. The
 * PENDING dedup stopped duplicate COMMANDS; it did nothing about the reads.
 */
describe('ManifestRefreshService.scheduleRefresh', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('collapses a burst of edits into ONE dispatch', async () => {
    const t = build();
    for (let i = 0; i < 25; i++) t.service.scheduleRefresh('c1');

    expect(t.prisma.device.findMany).not.toHaveBeenCalled(); // nothing yet
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(t.prisma.device.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps companies independent — one tenant burst never suppresses another', async () => {
    const t = build();
    t.service.scheduleRefresh('c1');
    t.service.scheduleRefresh('c2');

    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(t.prisma.device.findMany).toHaveBeenCalledTimes(2);
  });

  it('fires on the leading edge of the window, not a rolling one', async () => {
    // Trailing-edge debouncing would let a long stream of edits postpone the
    // refresh indefinitely — the opposite of what an operator watching a screen
    // wants.
    const t = build();
    t.service.scheduleRefresh('c1');
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 1);
    t.service.scheduleRefresh('c1'); // late edit must NOT push the timer out
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(t.prisma.device.findMany).toHaveBeenCalledTimes(1);
  });

  it('accepts a new burst once the previous one has fired', async () => {
    const t = build();
    t.service.scheduleRefresh('c1');
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();

    t.service.scheduleRefresh('c1');
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(t.prisma.device.findMany).toHaveBeenCalledTimes(2);
  });

  it('cancels scheduled dispatches on shutdown rather than leaking timers', async () => {
    const t = build();
    t.service.scheduleRefresh('c1');
    t.service.onModuleDestroy();

    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 5);
    await Promise.resolve();

    expect(t.prisma.device.findMany).not.toHaveBeenCalled();
  });
});
