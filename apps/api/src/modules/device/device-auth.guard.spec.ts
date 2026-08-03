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
  /** The row as the guard now selects it — device fields plus the two gates. */
  const row = { ...device, screen: { deletedAt: null }, company: { status: 'ACTIVE' } };

  it('accepts a valid token via Authorization: Bearer and scopes the request', async () => {
    const t = build();
    t.prisma.device.findFirst.mockResolvedValue(row);
    const { ctx, req } = contextWith({ authorization: 'Bearer tok123' });
    await expect(t.guard.canActivate(ctx)).resolves.toBe(true);
    expect(t.prisma.device.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deviceTokenHash: 'h:tok123', status: 'ACTIVE' } }),
    );
    expect(req.device).toEqual(device);
  });

  it('accepts a valid token via X-Device-Token', async () => {
    const t = build();
    t.prisma.device.findFirst.mockResolvedValue(row);
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

  it('never leaks device internals beyond the four scoped fields', async () => {
    const t = build();
    t.prisma.device.findFirst.mockResolvedValue({ ...row, deviceTokenHash: 'SECRET' });
    const { ctx, req } = contextWith({ authorization: 'Bearer tok123' });
    await t.guard.canActivate(ctx);
    expect(req.device).toEqual(device);
    expect(Object.keys(req.device)).not.toContain('deviceTokenHash');
  });

  /**
   * A live token is not enough — what it points AT must still exist. Deleting a
   * screen now revokes its device, but tokens issued before that fix are still
   * in the field, and this guard is the only thing that can stop them.
   */
  describe('the token target must still be valid', () => {
    it('rejects a device whose screen has been deleted', async () => {
      const t = build();
      t.prisma.device.findFirst.mockResolvedValue({
        ...row,
        screen: { deletedAt: new Date() },
      });
      const { ctx } = contextWith({ authorization: 'Bearer tok123' });
      await expect(t.guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      // ...and does not stamp lastSeenAt for a screen that no longer exists.
      expect(t.prisma.device.update).not.toHaveBeenCalled();
    });

    it('rejects a device whose company has been cancelled', async () => {
      const t = build();
      t.prisma.device.findFirst.mockResolvedValue({ ...row, company: { status: 'CANCELLED' } });
      const { ctx } = contextWith({ authorization: 'Bearer tok123' });
      await expect(t.guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('KEEPS a suspended company authenticated — suspension is recoverable', async () => {
      // The resolver already serves a suspended company an empty manifest with
      // a warning. Failing auth instead would put the player into an error loop
      // and drop the screen off the fleet view, exactly when an operator needs
      // to see it in order to resolve the suspension.
      const t = build();
      t.prisma.device.findFirst.mockResolvedValue({ ...row, company: { status: 'SUSPENDED' } });
      const { ctx, req } = contextWith({ authorization: 'Bearer tok123' });
      await expect(t.guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.device).toEqual(device);
    });

    it('gives the same opaque message for every rejection reason', async () => {
      const t = build();
      const messages: string[] = [];
      for (const bad of [
        null,
        { ...row, screen: { deletedAt: new Date() } },
        { ...row, company: { status: 'CANCELLED' } },
      ]) {
        t.prisma.device.findFirst.mockResolvedValue(bad);
        const { ctx } = contextWith({ authorization: 'Bearer tok123' });
        await t.guard.canActivate(ctx).catch((e: Error) => messages.push(e.message));
      }
      expect(new Set(messages).size).toBe(1);
    });
  });
});
