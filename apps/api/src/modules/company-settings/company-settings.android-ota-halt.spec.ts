import { CompanySettingsService } from './company-settings.service';

const actor = {
  userId: 'user-1',
  companyId: 'company-1',
  role: 'ADMIN',
  permissions: [],
} as never;

describe('CompanySettingsService Android OTA emergency halt', () => {
  it('disables rollout even when release files or canary ownership are no longer valid', async () => {
    const prisma = {
      company: {
        findFirst: jest.fn().mockResolvedValue({
          settings: {
            androidOta: {
              enabled: true,
              policyRevision: '2026-08-09T09:00:00.000Z',
            },
          },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      screen: { count: jest.fn() },
      screenGroup: { count: jest.fn() },
    };
    const releases = { find: jest.fn().mockReturnValue(null) };
    const service = new CompanySettingsService(
      prisma as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      releases as never,
    );
    jest.spyOn(service, 'get').mockResolvedValue({ androidOta: { enabled: false } } as never);

    await expect(
      service.updateAndroidOta('company-1', actor, {
        enabled: false,
        // Deliberately incomplete/stale values: a kill switch must not depend
        // on repairing the old policy first.
        targetVersionName: '1.4.2',
        rolloutPercent: 0,
        screenIds: ['11111111-1111-4111-8111-111111111111'],
        groupIds: ['22222222-2222-4222-8222-222222222222'],
      }),
    ).resolves.toEqual({ androidOta: { enabled: false } });

    expect(releases.find).not.toHaveBeenCalled();
    expect(prisma.screen.count).not.toHaveBeenCalled();
    expect(prisma.screenGroup.count).not.toHaveBeenCalled();
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'company-1' },
        data: expect.objectContaining({ settings: expect.any(Object) }),
      }),
    );
  });
});
