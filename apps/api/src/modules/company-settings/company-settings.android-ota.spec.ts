import { BadRequestException } from '@nestjs/common';

import { CompanySettingsService } from './company-settings.service';

const actor = {
  userId: 'user-1',
  companyId: 'company-1',
  role: 'ADMIN',
  permissions: [],
} as never;

function harness() {
  const prisma = {
    company: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    screen: { count: jest.fn() },
    screenGroup: { count: jest.fn() },
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new CompanySettingsService(
    prisma as never,
    activityLog as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, activityLog };
}

describe('CompanySettingsService Android OTA policy', () => {
  it('refuses to enable OTA without an exact target version', async () => {
    const { service, prisma } = harness();

    await expect(
      service.updateAndroidOta('company-1', actor, {
        enabled: true,
        rolloutPercent: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a canary screen outside the authenticated company', async () => {
    const { service, prisma } = harness();
    prisma.company.findFirst.mockResolvedValue({ settings: {} });
    prisma.screen.count.mockResolvedValue(1);

    await expect(
      service.updateAndroidOta('company-1', actor, {
        enabled: true,
        targetVersionCode: 42,
        rolloutPercent: 0,
        screenIds: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
      }),
    ).rejects.toThrow('Every OTA canary screen must belong to your company.');

    expect(prisma.screen.count).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        id: {
          in: [
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
          ],
        },
        deletedAt: null,
      },
    });
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('rejects a canary group outside the authenticated company', async () => {
    const { service, prisma } = harness();
    prisma.company.findFirst.mockResolvedValue({ settings: {} });
    prisma.screenGroup.count.mockResolvedValue(0);

    await expect(
      service.updateAndroidOta('company-1', actor, {
        enabled: true,
        targetVersionCode: 42,
        rolloutPercent: 0,
        groupIds: ['33333333-3333-4333-8333-333333333333'],
      }),
    ).rejects.toThrow('Every OTA canary group must belong to your company.');

    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('persists a complete replacement policy and audit summary', async () => {
    const { service, prisma, activityLog } = harness();
    prisma.company.findFirst
      .mockResolvedValueOnce({ settings: { notificationEmails: ['ops@example.com'] } })
      .mockResolvedValueOnce({
        id: 'company-1',
        name: 'Acme',
        slug: 'acme',
        status: 'ACTIVE',
        defaultLocale: 'en',
        timezone: 'UTC',
        settings: {
          notificationEmails: ['ops@example.com'],
          androidOta: {
            enabled: true,
            targetVersionCode: 42,
            rolloutPercent: 10,
            screenIds: [],
            groupIds: [],
            checkIntervalSeconds: 3600,
          },
        },
        fallbackContentId: null,
        defaultKioskPinHash: null,
        subscription: null,
      });
    prisma.company.update.mockResolvedValue({});

    const result = await service.updateAndroidOta('company-1', actor, {
      enabled: true,
      targetVersionCode: 42,
      rolloutPercent: 10,
      checkIntervalSeconds: 3600,
    });

    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: {
        settings: {
          notificationEmails: ['ops@example.com'],
          androidOta: {
            enabled: true,
            targetVersionCode: 42,
            rolloutPercent: 10,
            screenIds: [],
            groupIds: [],
            checkIntervalSeconds: 3600,
          },
        },
      },
    });
    expect(activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'company.android_ota_policy_changed',
        companyId: 'company-1',
      }),
    );
    expect(result.androidOta).toEqual(
      expect.objectContaining({ enabled: true, targetVersionCode: 42, rolloutPercent: 10 }),
    );
  });
});
