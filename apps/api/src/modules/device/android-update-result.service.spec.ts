import { AndroidUpdateService } from './android-update.service';

const device = {
  id: 'device-1',
  companyId: 'company-1',
  screenId: '11111111-1111-4111-8111-111111111111',
};

describe('AndroidUpdateService result telemetry', () => {
  it('stores the exact authorizing policy revision with the attempt', async () => {
    const prisma = {
      screen: {
        findFirst: jest.fn().mockResolvedValue({ capabilities: { existing: true } }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new AndroidUpdateService(prisma as never);
    const revision = '2026-08-09T09:00:00.000Z';

    await expect(
      service.recordResult(device as never, {
        state: 'INSTALLING',
        policyRevision: revision,
        targetVersionCode: 42,
        installedVersionCode: 41,
      }),
    ).resolves.toEqual({ ok: true });

    expect(prisma.screen.update).toHaveBeenCalledWith({
      where: { id: device.screenId },
      data: {
        capabilities: expect.objectContaining({
          existing: true,
          androidOta: expect.objectContaining({
            state: 'INSTALLING',
            policyRevision: revision,
            targetVersionCode: 42,
            installedVersionCode: 41,
          }),
        }),
      },
    });
  });
});
