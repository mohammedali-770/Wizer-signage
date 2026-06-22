import { SubscriptionStatus } from '@prisma/client';

import { SubscriptionsService } from './subscriptions.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    company: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
    plan: { findUnique: jest.fn() },
    subscription: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const usageLimits = { reconcileGrace: jest.fn().mockResolvedValue({}) };
  const service = new SubscriptionsService(prisma, activityLog as any, usageLimits as any);
  return { service, prisma, activityLog, usageLimits };
}

const actor: any = { userId: 'admin-1', isSuperAdmin: true, companyId: null, role: 'SUPER_ADMIN' };

describe('SubscriptionsService.create', () => {
  it('creates a trialing subscription with a trial end date and logs', async () => {
    const t = build();
    t.prisma.plan.findUnique.mockResolvedValue({ id: 'p1', code: 'pro', trialDays: 14 });
    t.prisma.subscription.findUnique.mockResolvedValue(null);
    t.prisma.subscription.create.mockResolvedValue({
      id: 'sub-1',
      status: 'TRIALING',
      plan: { code: 'pro' },
    });

    await t.service.create(actor, { companyId: 'c1', planId: 'p1' });

    expect(t.prisma.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SubscriptionStatus.TRIALING,
          trialEndsAt: expect.any(Date),
        }),
      }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subscription.created' }),
    );
  });
});

describe('SubscriptionsService.update', () => {
  it('records a status change in the audit metadata', async () => {
    const t = build();
    t.prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      companyId: 'c1',
      planId: 'p1',
      status: 'ACTIVE',
      plan: { code: 'pro' },
    });
    t.prisma.subscription.update.mockResolvedValue({
      id: 'sub-1',
      status: 'SUSPENDED',
      plan: { code: 'pro' },
    });

    await t.service.update(actor, 'sub-1', { status: SubscriptionStatus.SUSPENDED });

    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'subscription.updated',
        metadata: expect.objectContaining({ events: expect.arrayContaining(['status_changed']) }),
      }),
    );
    expect(t.usageLimits.reconcileGrace).not.toHaveBeenCalled();
  });

  it('reconciles the grace period after a plan change', async () => {
    const t = build();
    t.prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      companyId: 'c1',
      planId: 'p1',
      status: 'ACTIVE',
      plan: { code: 'pro' },
    });
    t.prisma.plan.findUnique.mockResolvedValue({ id: 'p2', code: 'biz' });
    t.prisma.subscription.update.mockResolvedValue({
      id: 'sub-1',
      status: 'ACTIVE',
      plan: { code: 'biz' },
    });

    await t.service.update(actor, 'sub-1', { planId: 'p2' });

    expect(t.usageLimits.reconcileGrace).toHaveBeenCalledWith('c1');
  });
});

describe('SubscriptionsService.cancel', () => {
  it('cancels and logs', async () => {
    const t = build();
    t.prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      companyId: 'c1',
      status: 'ACTIVE',
      plan: { code: 'pro' },
    });
    t.prisma.subscription.update.mockResolvedValue({
      id: 'sub-1',
      status: 'CANCELLED',
      plan: { code: 'pro' },
    });

    await t.service.cancel(actor, 'sub-1');

    expect(t.prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED', canceledAt: expect.any(Date) }),
      }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subscription.cancelled' }),
    );
  });
});
