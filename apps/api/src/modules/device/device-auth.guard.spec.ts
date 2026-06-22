import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { DeviceAuthGuard } from './device-auth.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    device: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const crypto = { sha256: jest.fn((s: string) => `h:${s}`) };
  const guard = new DeviceAuthGuard(prisma as any, crypto as any);
  return { guard, prisma, crypto };
}

function contextWith(headers: Record<string, string>) {
  const req: any = { headers };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('DeviceAuthGuard', () => {
  const device = { id: 'd1', deviceId: 'dev1', screenId: 's1', companyId: 'comp1' };

  it('accepts a valid token via Authorization: Bearer and scopes the request', async () => {
    const t = build();
    t.prisma.device.findFirst.mockResolvedValue(device);
    const { ctx, req } = contextWith({ authorization: 'Bearer tok123' });
    await expect(t.guard.canActivate(ctx)).resolves.toBe(true);
    expect(t.prisma.device.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deviceTokenHash: 'h:tok123', status: 'ACTIVE' } }),
    );
    expect(req.device).toEqual(device);
  });

  it('accepts a valid token via X-Device-Token', async () => {
    const t = build();
    t.prisma.device.findFirst.mockResolvedValue(device);
    const { ctx, req } = contextWith({ 'x-device-token': 'tok123' });
    await expect(t.guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.device).toEqual(device);
  });

  it('rejects a missing token', async () => {
    const t = build();
    const { ctx } = contextWith({});
    await expect(t.guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid/revoked token (no ACTIVE device)', async () => {
    const t = build();
    t.prisma.device.findFirst.mockResolvedValue(null);
    const { ctx } = contextWith({ authorization: 'Bearer bad' });
    await expect(t.guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
