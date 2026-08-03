import { HttpException, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';

import { AuthService } from './auth.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeUser(overrides: Partial<any> = {}): any {
  return {
    id: 'user-1',
    email: 'user@acme.test',
    name: 'User One',
    passwordHash: 'argon-hash',
    role: UserRole.VIEWER,
    status: UserStatus.ACTIVE,
    companyId: 'company-1',
    failedLoginCount: 0,
    lockedUntil: null,
    twoFactorEnabled: false,
    twoFactorEnforced: false,
    ...overrides,
  };
}

function build() {
  const prisma = {
    loginEvent: { create: jest.fn().mockResolvedValue({}) },
    twoFactorChallenge: {
      create: jest.fn().mockResolvedValue({ id: 'chal-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'chal-1', userId: 'user-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    verifyAsync: jest.fn(),
    decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  };
  const users = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    isLocked: jest.fn().mockReturnValue(false),
    // Mirrors the real implementation so the gates are exercised, not stubbed.
    isBlocked: jest.fn(
      (u: any) =>
        u.status === UserStatus.DISABLED ||
        (u.status === UserStatus.LOCKED && !u.lockedUntil) ||
        (!!u.lockedUntil && u.lockedUntil.getTime() > Date.now()),
    ),
    recordFailedLogin: jest.fn().mockResolvedValue({ locked: false }),
    recordSuccessfulLogin: jest.fn().mockResolvedValue(undefined),
    toView: jest.fn((u: any) => ({ id: u.id, email: u.email })),
  };
  const sessions = { create: jest.fn().mockResolvedValue({ id: 'session-1' }) };
  const companies = {
    findById: jest.fn().mockResolvedValue({ id: 'company-1', status: 'ACTIVE' }),
    isSuspended: jest.fn().mockReturnValue(false),
  };
  const twoFactor = { verifyCodeForUser: jest.fn() };
  const invitations = {};
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const mail = { send: jest.fn().mockResolvedValue(undefined) };
  const crypto = { sha256: jest.fn().mockReturnValue('hash'), hashEquals: jest.fn() };
  const password = { verify: jest.fn(), evaluate: jest.fn() };
  const config = {
    get: (key: string) =>
      key === 'jwt'
        ? {
            accessSecret: 'a'.repeat(20),
            refreshSecret: 'b'.repeat(20),
            accessTtl: '15m',
            refreshTtl: '30d',
            sessionInactivityTimeoutMinutes: 30,
          }
        : key === 'app'
          ? { dashboardUrl: 'http://localhost:3000', name: 'Wizer Signage' }
          : undefined,
  };

  const service = new AuthService(
    prisma as any,
    jwt as any,
    users as any,
    sessions as any,
    companies as any,
    twoFactor as any,
    invitations as any,
    activityLog as any,
    mail as any,
    crypto as any,
    password as any,
    config as any,
  );

  return { service, prisma, jwt, users, sessions, companies, twoFactor, password };
}

const meta = { ip: '127.0.0.1', userAgent: 'jest' };

describe('AuthService.login', () => {
  it('rejects unknown users with a generic error and records the attempt', async () => {
    const t = build();
    t.users.findByEmail.mockResolvedValue(null);

    await expect(
      t.service.login({ email: 'nobody@acme.test', password: 'x' }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(t.prisma.loginEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ success: false }) }),
    );
  });

  /**
   * Driven by real user rows rather than by stubbing the predicate, so these
   * also pin that the LOCKED status is enforced and not merely present.
   */
  it.each([
    [
      'a failed-login lockout still in its window',
      { status: UserStatus.LOCKED, lockedUntil: new Date(Date.now() + 60_000) },
    ],
    [
      'an indefinite administrative lock (LOCKED with no expiry)',
      { status: UserStatus.LOCKED, lockedUntil: null },
    ],
    [
      'a stale future lock on an otherwise active account',
      { status: UserStatus.ACTIVE, lockedUntil: new Date(Date.now() + 60_000) },
    ],
  ])('returns 423 for %s, without checking the password', async (_label, overrides) => {
    const t = build();
    t.users.findByEmail.mockResolvedValue(makeUser(overrides));

    let error: any;
    try {
      await t.service.login({ email: 'user@acme.test', password: 'x' }, meta);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(423);
    expect(t.password.verify).not.toHaveBeenCalled();
  });

  it('still returns 403 (not 423) for a disabled account', async () => {
    const t = build();
    t.users.findByEmail.mockResolvedValue(makeUser({ status: UserStatus.DISABLED }));

    let error: any;
    try {
      await t.service.login({ email: 'user@acme.test', password: 'x' }, meta);
    } catch (e) {
      error = e;
    }
    expect(error.getStatus()).toBe(403);
  });

  it('lets an account back in once its lockout window has elapsed', async () => {
    const t = build();
    t.users.findByEmail.mockResolvedValue(
      makeUser({ status: UserStatus.LOCKED, lockedUntil: new Date(Date.now() - 60_000) }),
    );
    t.password.verify.mockResolvedValue(true);

    await expect(
      t.service.login({ email: 'user@acme.test', password: 'x' }, meta),
    ).resolves.toBeDefined();
  });

  it('counts a failed login and rejects on a bad password', async () => {
    const t = build();
    t.users.findByEmail.mockResolvedValue(makeUser());
    t.password.verify.mockResolvedValue(false);

    await expect(
      t.service.login({ email: 'user@acme.test', password: 'bad' }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(t.users.recordFailedLogin).toHaveBeenCalled();
    expect(t.sessions.create).not.toHaveBeenCalled();
  });

  it('returns 423 when the failed attempt triggers a lockout', async () => {
    const t = build();
    t.users.findByEmail.mockResolvedValue(makeUser({ failedLoginCount: 6 }));
    t.password.verify.mockResolvedValue(false);
    t.users.recordFailedLogin.mockResolvedValue({ locked: true });

    let error: any;
    try {
      await t.service.login({ email: 'user@acme.test', password: 'bad' }, meta);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(423);
  });

  it('requires a 2FA step-up when 2FA is enabled (no session yet)', async () => {
    const t = build();
    t.users.findByEmail.mockResolvedValue(makeUser({ twoFactorEnabled: true }));
    t.password.verify.mockResolvedValue(true);

    const result: any = await t.service.login({ email: 'user@acme.test', password: 'good' }, meta);
    expect(result.requiresTwoFactor).toBe(true);
    expect(result.challengeToken).toBeDefined();
    expect(t.sessions.create).not.toHaveBeenCalled();
    // The lockout counter must NOT be cleared until the second factor passes.
    expect(t.users.recordSuccessfulLogin).not.toHaveBeenCalled();
  });

  it('issues a session for a valid login without 2FA requirement', async () => {
    const t = build();
    t.users.findByEmail.mockResolvedValue(makeUser());
    t.password.verify.mockResolvedValue(true);

    const result: any = await t.service.login({ email: 'user@acme.test', password: 'good' }, meta);
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.mustEnableTwoFactor).toBe(false);
    expect(t.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ mfaSatisfied: true }));
    expect(t.users.recordSuccessfulLogin).toHaveBeenCalled();
  });

  it('forces 2FA enrolment for a Super Admin without 2FA (mfa not satisfied)', async () => {
    const t = build();
    t.users.findByEmail.mockResolvedValue(
      makeUser({ role: UserRole.SUPER_ADMIN, companyId: null, twoFactorEnabled: false }),
    );
    t.password.verify.mockResolvedValue(true);

    const result: any = await t.service.login({ email: 'admin@acme.test', password: 'good' }, meta);
    expect(result.mustEnableTwoFactor).toBe(true);
    expect(t.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ mfaSatisfied: false }),
    );
  });
});

describe('AuthService.verifyTwoFactorLogin', () => {
  const challengePayload = { sub: 'user-1', cid: 'chal-1', typ: '2fa_challenge' };

  it('issues a session and consumes the challenge on a correct code (valid succeeds once)', async () => {
    const t = build();
    t.jwt.verifyAsync.mockResolvedValue(challengePayload);
    t.users.findById.mockResolvedValue(makeUser({ twoFactorEnabled: true }));
    t.twoFactor.verifyCodeForUser.mockResolvedValue(true);

    const result: any = await t.service.verifyTwoFactorLogin(
      { challengeToken: 'challenge.jwt', code: '123456' },
      meta,
    );
    expect(result.accessToken).toBeDefined();
    expect(t.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ mfaSatisfied: true }));
    expect(t.users.recordSuccessfulLogin).toHaveBeenCalledWith('user-1');
    // The challenge is consumed exactly once (single-use gate).
    expect(t.prisma.twoFactorChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ consumedAt: expect.any(Date) }) }),
    );
  });

  it('rejects a replayed (already consumed) challenge even within the lifetime', async () => {
    const t = build();
    t.jwt.verifyAsync.mockResolvedValue(challengePayload);
    // A consumed/replayed challenge is filtered out by the consumedAt:null guard.
    t.prisma.twoFactorChallenge.findFirst.mockResolvedValue(null);

    await expect(
      t.service.verifyTwoFactorLogin({ challengeToken: 'challenge.jwt', code: '123456' }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // The code is never even checked once the challenge is invalid.
    expect(t.twoFactor.verifyCodeForUser).not.toHaveBeenCalled();
  });

  it('rejects a concurrent double-consume race (updateMany count 0)', async () => {
    const t = build();
    t.jwt.verifyAsync.mockResolvedValue(challengePayload);
    t.users.findById.mockResolvedValue(makeUser({ twoFactorEnabled: true }));
    t.twoFactor.verifyCodeForUser.mockResolvedValue(true);
    t.prisma.twoFactorChallenge.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      t.service.verifyTwoFactorLogin({ challengeToken: 'challenge.jwt', code: '123456' }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(t.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects an expired challenge token', async () => {
    const t = build();
    // An expired JWT fails verification (mirrors a real expired challenge).
    t.jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(
      t.service.verifyTwoFactorLogin({ challengeToken: 'expired.jwt', code: '123456' }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid / wrong-typed challenge token', async () => {
    const t = build();
    t.jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', cid: 'chal-1', typ: 'access' });

    await expect(
      t.service.verifyTwoFactorLogin({ challengeToken: 'wrong.jwt', code: '123456' }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('counts a wrong 2FA code toward lockout without consuming the challenge', async () => {
    const t = build();
    t.jwt.verifyAsync.mockResolvedValue(challengePayload);
    t.users.findById.mockResolvedValue(makeUser({ twoFactorEnabled: true }));
    t.twoFactor.verifyCodeForUser.mockResolvedValue(false);

    await expect(
      t.service.verifyTwoFactorLogin({ challengeToken: 'challenge.jwt', code: '000000' }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(t.users.recordFailedLogin).toHaveBeenCalled();
    expect(t.prisma.twoFactorChallenge.updateMany).not.toHaveBeenCalled();
    expect(t.sessions.create).not.toHaveBeenCalled();
  });

  it('returns 423 when a failed 2FA code triggers a lockout', async () => {
    const t = build();
    t.jwt.verifyAsync.mockResolvedValue(challengePayload);
    t.users.findById.mockResolvedValue(makeUser({ twoFactorEnabled: true }));
    t.twoFactor.verifyCodeForUser.mockResolvedValue(false);
    t.users.recordFailedLogin.mockResolvedValue({ locked: true });

    let error: any;
    try {
      await t.service.verifyTwoFactorLogin(
        { challengeToken: 'challenge.jwt', code: '000000' },
        meta,
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(423);
  });
});
