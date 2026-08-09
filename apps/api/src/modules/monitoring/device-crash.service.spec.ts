import { DeviceCrashService } from './device-crash.service';

const device = {
  id: 'device-db-id',
  deviceId: 'tv-001',
  screenId: 'screen-1',
  companyId: 'company-1',
} as never;

describe('DeviceCrashService', () => {
  it('scopes by authenticated company and preserves existing capabilities', async () => {
    const prisma = {
      screen: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'screen-1',
          capabilities: { screenshot: true, kiosk: false },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new DeviceCrashService(prisma as never);

    const result = await service.record(device, {
      crashedAtMillis: 1_786_000_000_000,
      fingerprint: '0123456789abcdef01234567',
      crashCount: 3,
      appVersion: '1.2.3',
    });

    expect(prisma.screen.findFirst).toHaveBeenCalledWith({
      where: { id: 'screen-1', companyId: 'company-1', deletedAt: null },
      select: { id: true, capabilities: true },
    });
    expect(prisma.screen.update).toHaveBeenCalledWith({
      where: { id: 'screen-1' },
      data: {
        capabilities: expect.objectContaining({
          screenshot: true,
          kiosk: false,
          deviceCrash: expect.objectContaining({
            fingerprint: '0123456789abcdef01234567',
            crashCount: 3,
            appVersion: '1.2.3',
          }),
        }),
        appVersion: '1.2.3',
      },
    });
    expect(result).toEqual({ accepted: true });
  });
});
