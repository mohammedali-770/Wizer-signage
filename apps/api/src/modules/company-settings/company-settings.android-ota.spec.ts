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
  const androidReleases = {
    find: jest.fn().mockImplementation((versionName: string, versionCode: number) => ({
      versionName,
      versionCode,
      fileName: `wizer-signage-v${versionName}-${versionCode}.apk`,
    })),
  };
  const service = new CompanySettingsService(
    prisma as never,
    activityLog as never,
    {} as never,
    {} as never,
    androidReleases as never,
  );
  return { service, prisma, activityLog, androidReleases };
}

describe('CompanySettingsService Android OTA policy', () => {
  it('refuses to enable OTA without exact candidate and rollback identities', async () => {
    const { service, prisma } = harness();

    await expect(
      service.updateAndroidOta('company-1', actor, {
        enabled: true,
        targetVersionName: '1.4.2',
        targetVersionCode: 42,
        rolloutPercent: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateAndroidOta('company-1', actor, {
        enabled: true,
        rollbackVersionName: '1.4.1-safe',
        rollbackVersionCode: 43,
        rolloutPercent: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
  });

  it('requires rollback versionCode to move forward and both releases to be published', async () => {
    const { service, prisma, androidReleases } = harness();

    await expect(
      service.updateAndroidOta('company-1', actor, {
        enabled: true,
        targetVersionName: '1.4.2',
        targetVersionCode: 42,
        rollbackVersionName: '1.4.1-safe',
        rollbackVersionCode: 41,
        rolloutPercent: 5,
      }),
    ).rejects.toThrow('rollbackVersionCode must be greater than targetVersionCode');

    androidReleases.find.mockImplementation((name: string, code: number) =>
      name === '1.4.2' && code === 42
        ? { versionName: name, versionCode: code, fileName: 'candidate.apk' }
        : null,
    );
    await expect(
      service.updateAndroidOta('company-1', actor, {
        enabled: true,
        targetVersionName: '1.4.2',
        targetVersionCode: 42,
        rollbackVersionName: '1.4.1-safe',
        rollbackVersionCode: 43,
        rolloutPercent: 5,
      }),
    ).rejects.toThrow('Rollback Android release 1.4.1-safe/43 is not published');
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a canary screen outside the authenticated company', async () => {
    const { service, prisma } = harness();
    prisma.company.findFirst.mockResolvedValue({ settings: {} });
    prisma.screen.count.mockResolvedValue(1);

    await expect(
      service.updateAndroidOta('company-1', actor, {
        enabled: true,
        targetVersionName: '1.4.2',
        targetVersionCode: 42,
        rollbackVersionName: '1.4.1-safe',
        rollbackVersionCode: 43,
        rolloutPercent: 0,
        screenIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
      }),
    ).rejects.toThrow('Every OTA canary screen must belong to your company.');

    expect(prisma.screen.count).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        id: {
          in: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
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
        targetVersionName: '1.4.2',
        targetVersionCode: 42,
        rollbackVersionName: '1.4.1-safe',
        rollbackVersionCode: 43,
        rolloutPercent: 0,
        groupIds: ['33333333-3333-4333-8333-333333333333'],
      }),
    ).rejects.toThrow('Every OTA canary group must belong to your company.');

    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('persists a complete replacement policy, new revision, health gate, and audit summary', async () => {
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
            policyRevision: '2026-08-09T08:00:00.000Z',
            targetVersionName: '1.4.2',
            targetVersionCode: 42,
            rollbackVersionName: '1.4.1-safe',
            rollbackVersionCode: 43,
            rolloutPercent: 10,
            screenIds: [],
            groupIds: [],
            checkIntervalSeconds: 3600,
            healthWindowSeconds: 600,
            lastAutoRollback: null,
          },
        },
        fallbackContentId: null,
        defaultKioskPinHash: null,
        subscription: null,
      });
    prisma.company.update.mockResolvedValue({});

    const result = await service.updateAndroidOta('company-1', actor, {
      enabled: true,
      targetVersionName: '1.4.2',
      targetVersionCode: 42,
      rollbackVersionName: '1.4.1-safe',
      rollbackVersionCode: 43,
      rolloutPercent: 10,
      checkIntervalSeconds: 3600,
      healthWindowSeconds: 600,
    });

    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: {
        settings: {
          notificationEmails: ['ops@example.com'],
          androidOta: {
            enabled: true,
            policyRevision: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
            targetVersionName: '1.4.2',
            targetVersionCode: 42,
            rollbackVersionName: '1.4.1-safe',
            rollbackVersionCode: 43,
            rolloutPercent: 10,
            screenIds: [],
            groupIds: [],
            checkIntervalSeconds: 3600,
            healthWindowSeconds: 600,
            lastAutoRollback: null,
          },
        },
      },
    });
    expect(activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'company.android_ota_policy_changed',
        companyId: 'company-1',
        metadata: expect.objectContaining({
          policyRevision: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          targetVersionName: '1.4.2',
          targetVersionCode: 42,
          rollbackVersionName: '1.4.1-safe',
          rollbackVersionCode: 43,
          healthWindowSeconds: 600,
        }),
      }),
    );
    expect(result.androidOta).toEqual(
      expect.objectContaining({
        enabled: true,
        policyRevision: '2026-08-09T08:00:00.000Z',
        targetVersionName: '1.4.2',
        targetVersionCode: 42,
        rollbackVersionName: '1.4.1-safe',
        rollbackVersionCode: 43,
        rolloutPercent: 10,
        healthWindowSeconds: 600,
      }),
    );
  });
});
