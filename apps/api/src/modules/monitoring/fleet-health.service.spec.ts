import { FleetHealthService } from './fleet-health.service';

describe('FleetHealthService', () => {
  it('aggregates versions and recent bounded crash metadata within one company', async () => {
    const prisma = {
      screen: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'screen-a',
            name: 'A',
            status: 'ONLINE',
            appVersion: '1.2.3',
            lastHeartbeatAt: new Date('2026-08-09T06:00:00Z'),
            capabilities: {
              deviceCrash: {
                crashedAtMillis: 1_786_000_000_000,
                fingerprint: '0123456789abcdef01234567',
                crashCount: 2,
                reportedAt: '2026-08-09T06:01:00Z',
              },
            },
          },
          {
            id: 'screen-b',
            name: 'B',
            status: 'OFFLINE',
            appVersion: '1.2.3',
            lastHeartbeatAt: null,
            capabilities: {},
          },
          {
            id: 'screen-c',
            name: 'C',
            status: 'ONLINE',
            appVersion: null,
            lastHeartbeatAt: null,
            capabilities: {
              deviceCrash: {
                crashedAtMillis: 1_786_100_000_000,
                fingerprint: 'fedcba9876543210fedcba98',
                crashCount: 1,
              },
            },
          },
        ]),
      },
    };

    const result = await new FleetHealthService(prisma as never).summary('company-1');

    expect(prisma.screen.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company-1', deletedAt: null } }),
    );
    expect(result.totalScreens).toBe(3);
    expect(result.versionDistribution).toEqual([
      { version: '1.2.3', count: 2 },
      { version: 'unknown', count: 1 },
    ]);
    expect(result.recentCrashes.map((crash) => crash.screenId)).toEqual(['screen-c', 'screen-a']);
  });

  it('ignores malformed legacy crash capability shapes', async () => {
    const prisma = {
      screen: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'screen-a',
            name: 'A',
            status: 'ONLINE',
            appVersion: '1.0.0',
            lastHeartbeatAt: null,
            capabilities: { deviceCrash: { fingerprint: 'bad', crashCount: -1 } },
          },
        ]),
      },
    };

    const result = await new FleetHealthService(prisma as never).summary('company-1');
    expect(result.recentCrashes).toEqual([]);
  });
});
