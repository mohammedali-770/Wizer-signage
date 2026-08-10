import { AndroidUpdateService } from './android-update.service';

const device = {
  id: 'device-1',
  companyId: 'company-1',
  screenId: '11111111-1111-4111-8111-111111111111',
};
const revision = '2026-08-09T08:00:00.000Z';

function harness() {
  const prisma = {
    screen: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const service = new AndroidUpdateService(prisma as never);
  return { service, prisma };
}

function screenWithPolicy(androidOta: Record<string, unknown>, groupIds: string[] = []) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    groups: groupIds.map((groupId) => ({ groupId })),
    company: { settings: { androidOta } },
  };
}

describe('AndroidUpdateService rollout policy', () => {
  it('returns an exact immutable release identity and revision for an explicit canary', async () => {
    const { service, prisma } = harness();
    prisma.screen.findFirst.mockResolvedValue(
      screenWithPolicy({
        enabled: true,
        policyRevision: revision,
        targetVersionName: '1.4.2',
        targetVersionCode: 42,
        rolloutPercent: 0,
        screenIds: ['11111111-1111-4111-8111-111111111111'],
        groupIds: [],
        checkIntervalSeconds: 3600,
      }),
    );

    await expect(service.getPolicy(device as never)).resolves.toEqual(
      expect.objectContaining({
        enabled: true,
        eligible: true,
        policyRevision: revision,
        targetVersionName: '1.4.2',
        targetVersionCode: 42,
        rolloutPercent: 0,
        checkIntervalSeconds: 3600,
      }),
    );
  });

  it.each([
    [
      { enabled: true, targetVersionName: '1.4.2', targetVersionCode: 42, rolloutPercent: 100 },
      'missing revision',
    ],
    [
      {
        enabled: true,
        policyRevision: 'not-a-revision',
        targetVersionName: '1.4.2',
        targetVersionCode: 42,
        rolloutPercent: 100,
      },
      'malformed revision',
    ],
    [
      { enabled: true, policyRevision: revision, targetVersionCode: 42, rolloutPercent: 100 },
      'missing versionName',
    ],
    [
      {
        enabled: true,
        policyRevision: revision,
        targetVersionName: '../latest',
        targetVersionCode: 42,
        rolloutPercent: 100,
      },
      'unsafe versionName',
    ],
    [
      {
        enabled: true,
        policyRevision: revision,
        targetVersionName: '1.4.2',
        rolloutPercent: 100,
      },
      'missing versionCode',
    ],
  ])('fails closed for %s (%s)', async (policy, _reason) => {
    const { service, prisma } = harness();
    prisma.screen.findFirst.mockResolvedValue(screenWithPolicy(policy as Record<string, unknown>));

    const result = await service.getPolicy(device as never);
    expect(result.enabled).toBe(false);
    expect(result.eligible).toBe(false);
  });

  it('makes a same-company group canary eligible independently of rollout percentage', async () => {
    const { service, prisma } = harness();
    prisma.screen.findFirst.mockResolvedValue(
      screenWithPolicy(
        {
          enabled: true,
          policyRevision: revision,
          targetVersionName: '2.0.0',
          targetVersionCode: 50,
          rolloutPercent: 0,
          screenIds: [],
          groupIds: ['22222222-2222-4222-8222-222222222222'],
        },
        ['22222222-2222-4222-8222-222222222222'],
      ),
    );

    const result = await service.getPolicy(device as never);
    expect(result.enabled).toBe(true);
    expect(result.eligible).toBe(true);
  });
});
