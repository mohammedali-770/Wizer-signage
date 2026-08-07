import { BadRequestException, ConflictException } from '@nestjs/common';

import { PublicService } from './public.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const META = { ip: '1.2.3.4', userAgent: 'jest' };

function validTrialDto(overrides: Partial<any> = {}): any {
  return {
    fullName: 'Mohammed Ali',
    companyName: 'Acme Co',
    email: 'Owner@Acme.TEST',
    password: 'StrongPass!23',
    preferredLanguage: 'en',
    branches: 2,
    screens: 5,
    ...overrides,
  };
}

function build() {
  const tx = {
    company: { create: jest.fn().mockResolvedValue({ id: 'c1', slug: 'acme-co' }) },
    user: { create: jest.fn().mockResolvedValue({ id: 'u1' }) },
    location: { create: jest.fn().mockResolvedValue({ id: 'l1' }) },
  };
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue(null) },
    plan: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'plan-starter', code: 'starter', isActive: true, trialDays: 14 }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    company: { findUnique: jest.fn().mockResolvedValue(null) },
    demoRequest: { create: jest.fn().mockResolvedValue({ id: 'd1' }) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const password = {
    evaluate: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    hash: jest.fn().mockResolvedValue('argon-hash'),
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const mail = { send: jest.fn().mockResolvedValue({ messageId: 'm1', live: false }) };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'trial') return { days: 14, defaultPlanCode: 'starter' };
      if (key === 'app') return { dashboardUrl: 'https://dash.test' };
      return undefined;
    }),
  };
  const service = new PublicService(
    prisma as any,
    password as any,
    activityLog as any,
    mail as any,
    config as any,
  );
  return { service, prisma, password, activityLog, mail, tx };
}

describe('PublicService.trialSignup', () => {
  it('creates company + owner + trial subscription + branch and lowercases the email', async () => {
    const { service, prisma, tx } = build();
    const res = await service.trialSignup(validTrialDto(), META);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'owner@acme.test', deletedAt: null } }),
    );
    // Company created with a TRIALING subscription, owner is COMPANY_ADMIN (not SUPER_ADMIN).
    const companyArg = tx.company.create.mock.calls[0][0];
    expect(companyArg.data.subscription.create.status).toBe('TRIALING');
    const userArg = tx.user.create.mock.calls[0][0];
    expect(userArg.data.role).toBe('COMPANY_ADMIN');
    expect(userArg.data.status).toBe('ACTIVE');
    expect(tx.location.create).toHaveBeenCalledTimes(1);

    expect(res.companyId).toBe('c1');
    expect(res.email).toBe('owner@acme.test');
    expect(res.redirectUrl).toBe('https://dash.test/login');
    expect(typeof res.trialEndsAt).toBe('string');
  });

  it('rejects a duplicate email with 409', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'existing' });
    await expect(service.trialSignup(validTrialDto(), META)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a weak password with 400', async () => {
    const { service, password } = build();
    password.evaluate.mockReturnValueOnce({ valid: false, errors: ['Password too weak.'] });
    await expect(service.trialSignup(validTrialDto(), META)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('never lets a failed welcome email break the signup', async () => {
    const { service, mail } = build();
    mail.send.mockRejectedValue(new Error('smtp down'));
    await expect(service.trialSignup(validTrialDto(), META)).resolves.toMatchObject({
      companyId: 'c1',
    });
  });
});

describe('PublicService.demoRequest', () => {
  it('stores the lead and returns a received status', async () => {
    const { service, prisma, activityLog } = build();
    const res = await service.demoRequest(
      { name: 'Sara', company: 'Cafe X', email: 'Sara@x.TEST', screens: 3 } as any,
      META,
    );
    expect(prisma.demoRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'sara@x.test' }) }),
    );
    expect(activityLog.log).toHaveBeenCalled();
    expect(res).toEqual({ id: 'd1', status: 'received' });
  });
});

describe('PublicService.listPublicPlans', () => {
  /**
   * Prices come back as STRINGS, and a null yearly price stays null.
   *
   * This used to assert numbers — `listPublicPlans` passed each Decimal through
   * `Number()` while every other money field in the API was a string, so the
   * same column had two encodings depending on the endpoint. A JS float also
   * cannot round-trip a Decimal exactly, and this is billing data.
   *
   * `'0'` rather than `0` matters for a second reason: the pricing page treats
   * a zero price as "contact us", and `'0' === 0` is false. The test pins the
   * string so that comparison cannot silently start failing.
   */
  it('returns Decimal prices as strings and keeps a null yearly price', async () => {
    const { service, prisma } = build();
    prisma.plan.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        name: 'Starter',
        code: 'starter',
        description: 'd',
        priceMonthly: 199,
        priceYearly: 1990,
        currency: 'SAR',
        trialDays: 14,
        limits: { maxScreens: 5 },
      },
      {
        id: 'p3',
        name: 'Enterprise',
        code: 'enterprise',
        description: null,
        priceMonthly: 0,
        priceYearly: null,
        currency: 'SAR',
        trialDays: 14,
        limits: {},
      },
    ]);
    const plans = await service.listPublicPlans();
    expect(plans[0]).toMatchObject({
      code: 'starter',
      priceMonthly: '199',
      priceYearly: '1990',
    });
    expect(plans[1]).toMatchObject({ code: 'enterprise', priceMonthly: '0', priceYearly: null });

    // Types, not just values — toMatchObject would pass on a number 199 too.
    expect(typeof plans[0]?.priceMonthly).toBe('string');
    expect(typeof plans[0]?.priceYearly).toBe('string');
  });
});
