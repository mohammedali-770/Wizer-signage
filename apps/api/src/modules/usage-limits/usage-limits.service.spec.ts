import { ForbiddenException } from '@nestjs/common';

import { UsageLimitsService } from './usage-limits.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build(opts: {
  users?: number;
  pendingInvitations?: number;
  locations?: number;
  screens?: number;
  storageBytes?: bigint;
  limits?: Record<string, number | null>;
  gracePeriodEndsAt?: Date | null;
}) {
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    location: { count: jest.fn() },
    screen: { count: jest.fn() },
    user: { count: jest.fn() },
    invitation: { count: jest.fn() },
    content: { aggregate: jest.fn() },
    subscription: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    $transaction: jest
      .fn()
      .mockResolvedValue([
        opts.locations ?? 0,
        opts.screens ?? 0,
        opts.users ?? 0,
        opts.pendingInvitations ?? 0,
        { _sum: { fileSize: opts.storageBytes ?? BigInt(0) } },
      ]),
  };
  prisma.subscription.findUnique.mockResolvedValue({
    id: 'sub-1',
    status: 'ACTIVE',
    gracePeriodEndsAt: opts.gracePeriodEndsAt ?? null,
    plan: { code: 'starter', name: 'Starter', limits: opts.limits ?? {} },
  });
  const service = new UsageLimitsService(prisma, activityLog as any);
  return { service, prisma, activityLog };
}

const FUTURE = new Date(Date.now() + 3 * 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

describe('UsageLimitsService.evaluate', () => {
  it('reports ok when within limits', async () => {
    const { service } = build({ users: 5, limits: { maxUsers: 10 } });
    const ev = await service.evaluate('c1');
    expect(ev.status).toBe('ok');
    expect(ev.resources.find((r) => r.key === 'users')).toMatchObject({
      used: 5,
      limit: 10,
      exceeded: false,
    });
  });

  it('reports approaching at >= 80%', async () => {
    const { service } = build({ users: 8, limits: { maxUsers: 10 } });
    expect((await service.evaluate('c1')).status).toBe('approaching');
  });

  it('reports exceeded when over limit and no grace started', async () => {
    const { service } = build({ users: 11, limits: { maxUsers: 10 } });
    expect((await service.evaluate('c1')).status).toBe('exceeded');
  });

  it('reports grace while within the grace window', async () => {
    const { service } = build({ users: 11, limits: { maxUsers: 10 }, gracePeriodEndsAt: FUTURE });
    const ev = await service.evaluate('c1');
    expect(ev.status).toBe('grace');
    expect(ev.inGrace).toBe(true);
  });

  it('reports blocked once the grace window has elapsed', async () => {
    const { service } = build({ users: 11, limits: { maxUsers: 10 }, gracePeriodEndsAt: PAST });
    const ev = await service.evaluate('c1');
    expect(ev.status).toBe('blocked');
    expect(ev.graceExpired).toBe(true);
  });

  it('counts pending invitations toward the user seat limit', async () => {
    const { service } = build({ users: 3, pendingInvitations: 3, limits: { maxUsers: 5 } });
    const r = (await service.evaluate('c1')).resources.find((x) => x.key === 'users');
    expect(r).toMatchObject({ used: 6, exceeded: true });
  });

  it('treats a null/absent limit as unlimited', async () => {
    const { service } = build({ users: 9999, limits: { maxUsers: null } });
    const r = (await service.evaluate('c1')).resources.find((x) => x.key === 'users');
    expect(r).toMatchObject({ unlimited: true, exceeded: false });
  });
});

describe('UsageLimitsService.assertCanAdd', () => {
  it('allows adding while within the limit', async () => {
    const { service, prisma, activityLog } = build({ users: 5, limits: { maxUsers: 10 } });
    await expect(service.assertCanAdd('c1', 'users')).resolves.toBeUndefined();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(activityLog.log).not.toHaveBeenCalled();
  });

  it('starts a grace period (and allows) on first overage', async () => {
    const { service, prisma, activityLog } = build({ users: 10, limits: { maxUsers: 10 } });
    await expect(service.assertCanAdd('c1', 'users')).resolves.toBeUndefined();
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gracePeriodEndsAt: expect.any(Date) }),
      }),
    );
    expect(activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'usage.grace_period.started' }),
    );
  });

  it('blocks adding once the grace period has elapsed', async () => {
    const { service } = build({ users: 11, limits: { maxUsers: 10 }, gracePeriodEndsAt: PAST });
    await expect(service.assertCanAdd('c1', 'users')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
