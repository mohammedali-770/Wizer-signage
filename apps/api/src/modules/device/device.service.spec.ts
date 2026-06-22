import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { DeviceService } from './device.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const actor: any = { userId: 'u1', companyId: 'comp1', role: 'COMPANY_ADMIN' };

function build() {
  const prisma: any = {
    pairingCode: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    device: {
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    screen: {
      findFirst: jest.fn().mockResolvedValue({ id: 's1', status: 'UNPAIRED' }),
      findUnique: jest.fn().mockResolvedValue({ name: 'Lobby', orientation: 'LANDSCAPE' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  prisma.$transaction = jest.fn((arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
  );
  const crypto = {
    randomToken: jest.fn(() => 'rawtoken'),
    sha256: jest.fn((s: string) => `h:${s}`),
    hashEquals: jest.fn((a: string, b: string) => a === b),
    generatePairingCode: jest.fn(() => 'ABC123'),
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const resolver = {
    resolve: jest.fn().mockResolvedValue({ screenId: 's1', sourceType: 'NONE', items: [] }),
  };
  const service = new DeviceService(
    prisma as any,
    crypto as any,
    activityLog as any,
    resolver as any,
  );
  return { service, prisma, crypto, activityLog, resolver };
}

describe('DeviceService.startPairing', () => {
  it('mints a unique code + private secret and logs', async () => {
    const t = build();
    t.prisma.pairingCode.findUnique.mockResolvedValue(null); // code is unique
    const result = await t.service.startPairing({ deviceId: 'dev1', appVersion: '1.0' });
    expect(result.code).toBe('ABC123');
    expect(result.pairingSecret).toBe('rawtoken');
    expect(t.prisma.pairingCode.create).toHaveBeenCalled();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'device.pairing_started' }),
    );
  });
});

describe('DeviceService.pairingStatus', () => {
  it('requires the pairing secret', async () => {
    const t = build();
    await expect(t.service.pairingStatus('ABC123', undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a wrong secret', async () => {
    const t = build();
    t.prisma.pairingCode.findUnique.mockResolvedValue({
      id: 'pc1',
      status: 'PENDING',
      pairingSecretHash: 'h:right',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(t.service.pairingStatus('ABC123', 'wrong')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('marks an expired PENDING code expired', async () => {
    const t = build();
    t.prisma.pairingCode.findUnique.mockResolvedValue({
      id: 'pc1',
      status: 'PENDING',
      pairingSecretHash: 'h:s',
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await t.service.pairingStatus('ABC123', 's');
    expect(res.status).toBe('expired');
    expect(t.prisma.pairingCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXPIRED' } }),
    );
  });

  it('returns pending while unclaimed', async () => {
    const t = build();
    t.prisma.pairingCode.findUnique.mockResolvedValue({
      id: 'pc1',
      status: 'PENDING',
      pairingSecretHash: 'h:s',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await t.service.pairingStatus('ABC123', 's');
    expect(res.status).toBe('pending');
  });

  it('issues the device token once after the code is claimed', async () => {
    const t = build();
    t.prisma.pairingCode.findUnique.mockResolvedValue({
      id: 'pc1',
      status: 'CLAIMED',
      screenId: 's1',
      deviceId: 'dev1',
      pairingSecretHash: 'h:s',
      expiresAt: new Date(Date.now() + 60_000),
      deviceInfo: { appVersion: '1.0' },
    });
    t.prisma.device.findUnique.mockResolvedValue({
      id: 'd1',
      deviceId: 'dev1',
      status: 'PENDING',
      deviceTokenHash: null,
      companyId: 'comp1',
    });
    const res: any = await t.service.pairingStatus('ABC123', 's');
    expect(res.status).toBe('paired');
    expect(res.deviceToken).toBe('rawtoken');
    expect(res.screenId).toBe('s1');
    expect(t.prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deviceTokenHash: 'h:rawtoken', status: 'ACTIVE' }),
      }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'device.token_issued' }),
    );
  });

  it('does not re-issue a token once collected', async () => {
    const t = build();
    t.prisma.pairingCode.findUnique.mockResolvedValue({
      id: 'pc1',
      status: 'CLAIMED',
      screenId: 's1',
      deviceId: 'dev1',
      pairingSecretHash: 'h:s',
      expiresAt: new Date(Date.now() + 60_000),
      deviceInfo: {},
    });
    t.prisma.device.findUnique.mockResolvedValue({
      id: 'd1',
      deviceId: 'dev1',
      status: 'ACTIVE',
      deviceTokenHash: 'h:existing',
      companyId: 'comp1',
    });
    const res: any = await t.service.pairingStatus('ABC123', 's');
    expect(res.status).toBe('paired');
    expect(res.deviceToken).toBeUndefined();
  });
});

describe('DeviceService.pairScreen', () => {
  it('binds a PENDING code to a same-company screen and logs', async () => {
    const t = build();
    t.prisma.pairingCode.findUnique.mockResolvedValue({
      id: 'pc1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      deviceId: 'dev1',
      deviceInfo: {},
    });
    t.prisma.device.findUnique.mockResolvedValue({
      deviceId: 'dev1',
      status: 'PENDING',
      pairedAt: null,
      lastSeenAt: null,
    });
    await t.service.pairScreen('comp1', actor, 's1', { pairingCode: 'abc123' });
    expect(t.prisma.pairingCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CLAIMED', companyId: 'comp1', screenId: 's1' }),
      }),
    );
    expect(t.prisma.device.upsert).toHaveBeenCalled();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'screen.paired' }),
    );
  });

  it('rejects pairing a screen from another company (404)', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(null);
    await expect(
      t.service.pairScreen('comp1', actor, 'other', { pairingCode: 'abc123' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an already-used (non-PENDING) code', async () => {
    const t = build();
    t.prisma.pairingCode.findUnique.mockResolvedValue({
      id: 'pc1',
      status: 'CLAIMED',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      t.service.pairScreen('comp1', actor, 's1', { pairingCode: 'abc123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired code', async () => {
    const t = build();
    t.prisma.pairingCode.findUnique.mockResolvedValue({
      id: 'pc1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      t.service.pairScreen('comp1', actor, 's1', { pairingCode: 'abc123' }),
    ).rejects.toThrow(/expired/i);
  });
});

describe('DeviceService.unpairScreen', () => {
  it('revokes the device token and resets the screen + logs', async () => {
    const t = build();
    t.prisma.device.findUnique.mockResolvedValue({ deviceId: 'dev1', status: 'ACTIVE' });
    await t.service.unpairScreen('comp1', actor, 's1');
    expect(t.prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REVOKED', deviceTokenHash: null }),
      }),
    );
    expect(t.prisma.screen.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'UNPAIRED', deviceIdentifier: null }),
      }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'screen.unpaired' }),
    );
  });

  it('rejects unpairing a screen that is not paired', async () => {
    const t = build();
    t.prisma.device.findUnique.mockResolvedValue(null);
    await expect(t.service.unpairScreen('comp1', actor, 's1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('DeviceService.getManifest', () => {
  it('resolves only the device’s own screen/company', async () => {
    const t = build();
    const device = { id: 'd1', deviceId: 'dev1', screenId: 's1', companyId: 'comp1' };
    await t.service.getManifest(device as any);
    expect(t.resolver.resolve).toHaveBeenCalledWith('comp1', 's1', expect.any(Date));
  });
});

describe('DeviceService.recordSyncStatus', () => {
  it('stores the sync snapshot on the device’s own row only', async () => {
    const t = build();
    const device = { id: 'd1', deviceId: 'dev1', screenId: 's1', companyId: 'comp1' };
    await t.service.recordSyncStatus(device as any, {
      status: 'PARTIAL' as any,
      manifestSource: 'LOCAL_CACHE',
      requiredAssets: 5,
      cachedAssets: 3,
      failedDownloads: 1,
      cacheSizeBytes: 123456,
      failedAssetIds: ['x'],
    });
    expect(t.prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({
          syncStatus: 'PARTIAL',
          manifestSource: 'LOCAL_CACHE',
          requiredAssets: 5,
          cacheSizeBytes: BigInt(123456),
          syncMetadata: { failedAssetIds: ['x'] },
        }),
      }),
    );
  });
});
