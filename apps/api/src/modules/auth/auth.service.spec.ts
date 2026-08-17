import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';

import { Permission } from '../../common/rbac/permissions';
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
    // Verified by default because every real user is: invitation acceptance and
    // the seed both stamp it. Null means specifically "unverified public trial
    // signup", which is exercised in its own tests below.
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
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
    passwordResetToken: {
      create: jest.fn().mockResolvedValue({ id: 'prt-1' }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
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
    setPassword: jest.fn().mockResolvedValue(undefined),
    getRecentPasswordHashes: jest.fn().mockResolvedValue([]),
    isBlocked: jest.fn(
      (u: any) =>
        u.status === UserStatus.DISABLED ||
        (u.status === UserStatus.LOCKED && !u.lockedUntil) ||
        (!!u.lockedUntil && u.lockedUntil.getTime() > Date.now()),
    ),
    recordFailedLogin: jest.fn().mockResolvedValue({ locked: false }),
    recordSuccessfulLogin: jest.fn().mockResolvedValue(undefined),
    createFromInvitation: jest.fn(async (input: any) =>
      makeUser({ id: 'invited-1', email: input.email, name: input.name, role: input.role }),
    ),
    toView: jest.fn((u: any) => ({ id: u.id, email: u.email })),
  };
  const sessions = {
    create: jest.fn().mockResolvedValue({ id: 'session-1' }),
    validateForAccess: jest.fn(),
    rotate: jest.fn().mockResolvedValue({}),
    revoke: jest.fn().mockResolvedValue(undefined),
    revokeAllForUser: jest.fn().mockResolvedValue(0),
    // Mirrors the real implementation so the refresh gate is exercised.
    isWithinRotationGrace: jest.fn(
      (sess: any, presented: string, now: number = Date.now()) =>
        !!sess.previousRefreshTokenHash &&
        !!sess.refreshRotatedAt &&
        sess.previousRefreshTokenHash === presented &&
        now - sess.refreshRotatedAt.getTime() <= 30_000,
    ),
  };
  const companies = {
    findById: jest.fn().mockResolvedValue({ id: 'company-1', status: 'ACTIVE' }),
    isSuspended: jest.fn().mockReturnValue(false),
  };
  const twoFactor = { verifyCodeForUser: jest.fn() };
  const invitations = {
    consumeByToken: jest.fn().mockResolvedValue({
      id: 'inv-1',
      email: 'invitee@acme.test',
      role: UserRole.LOCATION_MANAGER,
      companyId: 'company-1',
      locationIds: ['loc-1'],
    }),
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const mail = { send: jest.fn().mockResolvedValue(undefined) };
  const crypto = {
    sha256: jest.fn().mockReturnValue('hash'),
    hashEquals: jest.fn(),
    randomToken: jest.fn().mockReturnValue('RAWTOKEN'),
  };
  const password = {
    verify: jest.fn(),
    evaluate: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    hash: jest.fn().mockResolvedValue('new-hash'),
  };
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

  return {
    service,
    prisma,
    jwt,
    users,
    sessions,
    companies,
    twoFactor,
    password,
    crypto,
    mail,
    activityLog,
    invitations,
  };
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

  describe('unverified email', () => {
    it('refuses login until the address is confirmed', async () => {
      const t = build();
      t.users.findByEmail.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
      t.password.verify.mockResolvedValue(true);

      await expect(
        t.service.login({ email: 'user@acme.test', password: 'ok' }, meta),
      ).rejects.toMatchObject({ response: { code: 'EMAIL_NOT_VERIFIED' } });
    });

    it('checks the password FIRST, so it is not an existence oracle', async () => {
      const t = build();
      t.users.findByEmail.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
      t.password.verify.mockResolvedValue(false);

      // A wrong password on an unverified account must be indistinguishable
      // from a wrong password anywhere else. Answering EMAIL_NOT_VERIFIED here
      // would confirm the address exists to anyone who can type it.
      await expect(
        t.service.login({ email: 'user@acme.test', password: 'wrong' }, meta),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('issues no session and records the refusal', async () => {
      const t = build();
      t.users.findByEmail.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
      t.password.verify.mockResolvedValue(true);

      await t.service
        .login({ email: 'user@acme.test', password: 'ok' }, meta)
        .catch(() => undefined);

      expect(t.sessions.create).not.toHaveBeenCalled();
      expect(t.prisma.loginEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ success: false, reason: 'email_unverified' }),
        }),
      );
    });

    it('lets a verified account straight through', async () => {
      const t = build();
      t.users.findByEmail.mockResolvedValue(makeUser({ emailVerifiedAt: new Date() }));
      t.password.verify.mockResolvedValue(true);

      await expect(
        t.service.login({ email: 'user@acme.test', password: 'ok' }, meta),
      ).resolves.toBeDefined();
    });
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

/**
 * Refresh-token rotation.
 *
 * Rotation replaces the stored hash the instant this endpoint succeeds, and a
 * non-matching token destroys the entire session as suspected theft. Correct for
 * real reuse — but it also fired when the client simply never RECEIVED the
 * rotated token (dropped response, app killed mid-request, two tabs refreshing
 * at once), logging the user out and recording it as an attack.
 */
describe('AuthService.refresh', () => {
  const SESSION = {
    id: 'session-1',
    userId: 'user-1',
    refreshTokenHash: 'sha:current',
    previousRefreshTokenHash: null as string | null,
    refreshRotatedAt: null as Date | null,
    mfaSatisfied: true,
  };

  function setup(sessionOverrides: Partial<typeof SESSION> = {}, presented = 'current') {
    const t = build();
    t.jwt.verifyAsync.mockResolvedValue({ typ: 'refresh', sub: 'user-1', sid: 'session-1' });
    t.sessions.validateForAccess.mockResolvedValue({ ...SESSION, ...sessionOverrides });
    t.users.findById.mockResolvedValue(makeUser());
    // sha256 is stubbed to a stable, inspectable transform.
    t.crypto.sha256.mockImplementation((v: string) => `sha:${v}`);
    t.crypto.hashEquals.mockImplementation((a: string, b: string) => a === b);
    return { t, presented };
  }

  it('rotates and returns a new pair for the current token', async () => {
    const { t } = setup();
    await expect(t.service.refresh('current')).resolves.toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expect(t.sessions.revoke).not.toHaveBeenCalled();
  });

  it('remembers exactly one generation when rotating', async () => {
    const { t } = setup();
    await t.service.refresh('current');
    // 4th argument is the outgoing hash, kept as the grace generation.
    expect(t.sessions.rotate).toHaveBeenCalledWith(
      'session-1',
      expect.any(String),
      expect.any(Date),
      'sha:current',
    );
  });

  it('accepts a retry with the previous token inside the grace window', async () => {
    const { t } = setup({
      previousRefreshTokenHash: 'sha:stale',
      refreshRotatedAt: new Date(),
    });
    await expect(t.service.refresh('stale')).resolves.toBeDefined();
    expect(t.sessions.revoke).not.toHaveBeenCalled();
  });

  it('still destroys the session for a token replayed after the window', async () => {
    const { t } = setup({
      previousRefreshTokenHash: 'sha:stale',
      refreshRotatedAt: new Date(Date.now() - 60_000),
    });
    await expect(t.service.refresh('stale')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(t.sessions.revoke).toHaveBeenCalledWith('session-1', 'refresh_reuse_detected');
  });

  it('still destroys the session for a token that was never this session s', async () => {
    const { t } = setup({
      previousRefreshTokenHash: 'sha:stale',
      refreshRotatedAt: new Date(),
    });
    await expect(t.service.refresh('stolen-from-elsewhere')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(t.sessions.revoke).toHaveBeenCalledWith('session-1', 'refresh_reuse_detected');
  });

  it('revokes the session when the account has become blocked', async () => {
    const { t } = setup();
    t.users.findById.mockResolvedValue(makeUser({ status: UserStatus.LOCKED, lockedUntil: null }));
    await expect(t.service.refresh('current')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(t.sessions.revoke).toHaveBeenCalledWith('session-1', 'user_inactive');
  });

  it('rejects an access token presented at the refresh endpoint', async () => {
    const { t } = setup();
    t.jwt.verifyAsync.mockResolvedValue({ typ: 'access', sub: 'user-1', sid: 'session-1' });
    await expect(t.service.refresh('current')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

/**
 * Password reset.
 *
 * Every branch here is reachable by an unauthenticated caller, so the
 * interesting assertions are about what is NOT revealed and what is NOT left
 * usable — not the happy path.
 */
describe('AuthService.forgotPassword', () => {
  it('returns success for an unknown email without creating a token', async () => {
    // Uniform response: a different status or timing tells an attacker which
    // addresses have accounts.
    const { service, prisma } = build();
    await expect(service.forgotPassword({ email: 'nobody@example.com' }, meta)).resolves.toEqual({
      success: true,
    });
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('issues a token for a real account', async () => {
    const { service, prisma, users } = build();
    users.findByEmail.mockResolvedValue(makeUser());
    await service.forgotPassword({ email: 'user@acme.test' }, meta);
    expect(prisma.passwordResetToken.create).toHaveBeenCalled();
  });

  it('stores only a hash of the token, never the token itself', async () => {
    const { service, prisma, users, crypto } = build();
    users.findByEmail.mockResolvedValue(makeUser());
    await service.forgotPassword({ email: 'user@acme.test' }, meta);

    const data = prisma.passwordResetToken.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe('hash');
    expect(JSON.stringify(data)).not.toContain('RAWTOKEN');
    expect(crypto.sha256).toHaveBeenCalledWith('RAWTOKEN');
  });

  it('still returns success when the mail transport fails', async () => {
    // The enumeration oracle: a 500 for real accounts and a 200 for unknown
    // ones distinguishes them precisely. The row is already persisted, so the
    // user can retry once mail recovers.
    const { service, mail, users } = build();
    users.findByEmail.mockResolvedValue(makeUser());
    mail.send.mockRejectedValue(new Error('SMTP down'));

    await expect(service.forgotPassword({ email: 'user@acme.test' }, meta)).resolves.toEqual({
      success: true,
    });
  });

  it('does not issue a token for a disabled account', async () => {
    const { service, prisma, users } = build();
    users.findByEmail.mockResolvedValue(makeUser({ status: UserStatus.DISABLED }));
    await service.forgotPassword({ email: 'user@acme.test' }, meta);
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('does not issue a token for an account with no password (invited, never accepted)', async () => {
    const { service, prisma, users } = build();
    users.findByEmail.mockResolvedValue(makeUser({ passwordHash: null }));
    await service.forgotPassword({ email: 'user@acme.test' }, meta);
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.resetPassword', () => {
  const validToken = () => ({
    id: 'prt-1',
    userId: 'user-1',
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  });

  it('rejects an unknown token', async () => {
    const { service, prisma } = build();
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);
    await expect(
      service.resetPassword({ token: 't', password: 'Str0ng!Passw0rd' }, meta),
    ).rejects.toThrow(/invalid or has expired/i);
  });

  it('rejects an already-used token', async () => {
    // Single use: a reset link forwarded or found in a mailbox later must not
    // work a second time.
    const { service, prisma } = build();
    prisma.passwordResetToken.findUnique.mockResolvedValue({ ...validToken(), usedAt: new Date() });
    await expect(
      service.resetPassword({ token: 't', password: 'Str0ng!Passw0rd' }, meta),
    ).rejects.toThrow(/invalid or has expired/i);
  });

  it('rejects an expired token', async () => {
    const { service, prisma } = build();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      ...validToken(),
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      service.resetPassword({ token: 't', password: 'Str0ng!Passw0rd' }, meta),
    ).rejects.toThrow(/invalid or has expired/i);
  });

  it('gives the same message for every rejection', async () => {
    // Distinguishing "unknown" from "expired" would confirm that a token, and
    // therefore an account, exists.
    const { service, prisma } = build();
    const messages: string[] = [];
    for (const record of [null, { ...validToken(), usedAt: new Date() }]) {
      prisma.passwordResetToken.findUnique.mockResolvedValue(record);
      await service
        .resetPassword({ token: 't', password: 'Str0ng!Passw0rd' }, meta)
        .catch((e: Error) => messages.push(e.message));
    }
    expect(new Set(messages).size).toBe(1);
  });

  it('consumes the token and invalidates any other outstanding ones', async () => {
    const { service, prisma, users } = build();
    prisma.passwordResetToken.findUnique.mockResolvedValue(validToken());
    users.findById.mockResolvedValue(makeUser());

    await service.resetPassword({ token: 't', password: 'Str0ng!Passw0rd' }, meta);

    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
    );
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ usedAt: null }) }),
    );
  });

  it('revokes every session on success', async () => {
    // A reset is the response to a suspected compromise; leaving the attacker's
    // session alive would defeat the point.
    const { service, prisma, users, sessions } = build();
    prisma.passwordResetToken.findUnique.mockResolvedValue(validToken());
    users.findById.mockResolvedValue(makeUser());

    await service.resetPassword({ token: 't', password: 'Str0ng!Passw0rd' }, meta);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('user-1', 'password_reset');
  });

  it('rejects when the token points at a user that no longer exists', async () => {
    const { service, prisma, users } = build();
    prisma.passwordResetToken.findUnique.mockResolvedValue(validToken());
    users.findById.mockResolvedValue(null);
    await expect(
      service.resetPassword({ token: 't', password: 'Str0ng!Passw0rd' }, meta),
    ).rejects.toThrow(/invalid or has expired/i);
  });
});

const principal = {
  userId: 'user-1',
  email: 'user@acme.test',
  role: UserRole.VIEWER,
  companyId: 'company-1',
  sessionId: 'session-1',
  isSuperAdmin: false,
  mfaSatisfied: false,
  twoFactorRequired: false,
} as any;

describe('AuthService.logout', () => {
  it('revokes the session the caller is holding', async () => {
    const t = build();
    await expect(t.service.logout(principal)).resolves.toEqual({ success: true });
    expect(t.sessions.revoke).toHaveBeenCalledWith('session-1', 'logout');
  });

  it('revokes only the calling session, not every session for the user', async () => {
    // Logging out of one browser must not sign the user out of their phone.
    // `revokeAllForUser` here would be a silent behaviour change with no
    // failing test to catch it.
    const t = build();
    await t.service.logout(principal);
    expect(t.sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('audits the logout', async () => {
    const t = build();
    await t.service.logout(principal);
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.logout', actorId: 'user-1' }),
    );
  });
});

describe('AuthService.acceptInvitation', () => {
  const dto = { token: 'INVITE', name: 'New Person', password: 'Str0ng!Passw0rd' };

  it('creates the user from the invitation and returns the invited email', async () => {
    const t = build();
    await expect(t.service.acceptInvitation(dto)).resolves.toEqual({
      accepted: true,
      email: 'invitee@acme.test',
    });
  });

  it('takes email, role and company from the invitation, never from the request', async () => {
    // The DTO is attacker-controlled. If any of these were read off `dto`, an
    // invitee could self-promote to SUPER_ADMIN or land in another tenant.
    const t = build();
    await t.service.acceptInvitation({
      ...dto,
      email: 'attacker@evil.test',
      role: UserRole.SUPER_ADMIN,
      companyId: 'company-2',
    } as any);

    expect(t.users.createFromInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'invitee@acme.test',
        role: UserRole.LOCATION_MANAGER,
        companyId: 'company-1',
      }),
    );
  });

  it('rejects a weak password without consuming the invitation', async () => {
    // A single-use token burned by a failed password-policy check leaves the
    // invitee unable to sign up at all and needing an admin to re-invite.
    const t = build();
    t.password.evaluate.mockReturnValue({ valid: false, errors: ['Password is too short.'] });

    await expect(t.service.acceptInvitation({ ...dto, password: 'short' })).rejects.toThrow(
      /too short/i,
    );
    expect(t.invitations.consumeByToken).not.toHaveBeenCalled();
    expect(t.users.createFromInvitation).not.toHaveBeenCalled();
  });

  it('never stores the plaintext password', async () => {
    const t = build();
    await t.service.acceptInvitation(dto);
    expect(t.password.hash).toHaveBeenCalledWith(dto.password);
    expect(t.users.createFromInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'new-hash' }),
    );
  });

  it('does not create a user when the token is already spent', async () => {
    const t = build();
    t.invitations.consumeByToken.mockRejectedValue(
      new BadRequestException('This invitation has already been used.'),
    );

    await expect(t.service.acceptInvitation(dto)).rejects.toThrow(/already been used/i);
    expect(t.users.createFromInvitation).not.toHaveBeenCalled();
  });

  it('audits both the user creation and the acceptance', async () => {
    const t = build();
    await t.service.acceptInvitation(dto);
    const actions = t.activityLog.log.mock.calls.map((c: any[]) => c[0].action);
    expect(actions).toEqual(expect.arrayContaining(['user.created', 'invitation.accepted']));
  });
});

describe('AuthService.getMe', () => {
  it('rejects a principal whose user record no longer exists', async () => {
    // The access token outlives a hard-deleted account; without this the
    // request would proceed with a null user.
    const t = build();
    t.users.findById.mockResolvedValue(null);
    await expect(t.service.getMe(principal)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns the permission set for the stored role', async () => {
    const t = build();
    t.users.findById.mockResolvedValue(makeUser({ role: UserRole.VIEWER }));

    const me = await t.service.getMe(principal);
    expect(me.permissions).toEqual(expect.arrayContaining([Permission.ScreenRead]));
    expect(me.permissions).not.toContain(Permission.UserUpdate);
  });

  it('derives permissions from the DATABASE role, not the token claim', async () => {
    // A role demotion must take effect on the next request. Reading
    // `principal.role` would keep the old permissions alive until the access
    // token expired.
    const t = build();
    t.users.findById.mockResolvedValue(makeUser({ role: UserRole.VIEWER }));

    const me = await t.service.getMe({ ...principal, role: UserRole.COMPANY_ADMIN });
    expect(me.permissions).not.toContain(Permission.UserUpdate);
  });

  it('grants a Super Admin the full permission set', async () => {
    const t = build();
    t.users.findById.mockResolvedValue(makeUser({ role: UserRole.SUPER_ADMIN, companyId: null }));

    const me = await t.service.getMe({ ...principal, isSuperAdmin: true });
    expect(me.permissions).toEqual(expect.arrayContaining(Object.values(Permission)));
  });

  it('reports the session 2FA state so the dashboard can gate on it', async () => {
    const t = build();
    t.users.findById.mockResolvedValue(makeUser());

    const me = await t.service.getMe({
      ...principal,
      mfaSatisfied: false,
      twoFactorRequired: true,
    });
    expect(me).toMatchObject({ mfaSatisfied: false, twoFactorRequired: true });
  });

  it('returns the redacted view, never the raw record', async () => {
    // `toView` is what strips passwordHash and the 2FA secret.
    const t = build();
    t.users.findById.mockResolvedValue(makeUser());

    const me = await t.service.getMe(principal);
    expect(t.users.toView).toHaveBeenCalled();
    expect(me.user).not.toHaveProperty('passwordHash');
    expect(me.user).not.toHaveProperty('twoFactorSecret');
  });
});
