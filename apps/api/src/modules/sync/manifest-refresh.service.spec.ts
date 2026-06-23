import { ManifestRefreshService } from './manifest-refresh.service';

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
