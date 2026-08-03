import { UnauthorizedException } from '@nestjs/common';

import { JwtStrategy } from './jwt.strategy';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ADMIN = {
  id: 'admin-1',
  email: 'admin@wizer.test',
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
  companyId: null,
  lockedUntil: null,
  twoFactorEnabled: true,
  twoFactorEnforced: true,
};

function build() {
  const sessions = { validateForAccess: jest.fn() };
  const users = {
    findById: jest.fn().mockResolvedValue(ADMIN),
    isLocked: jest.fn().mockReturnValue(false),
    isBlocked: jest.fn().mockReturnValue(false),
  };
  const companies = {
    findById: jest.fn().mockResolvedValue({ id: 'c1', status: 'ACTIVE' }),
    isSuspended: jest.fn().mockReturnValue(false),
  };
  const config = { get: () => ({ accessSecret: 'a'.repeat(32) }) };
  const strategy = new JwtStrategy(config as any, users as any, sessions as any, companies as any);
  return { strategy, sessions, users, companies };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    userId: 'admin-1',
    companyId: null,
    mfaSatisfied: true,
    impersonatorId: null,
    ...overrides,
  };
}

const payload: any = { typ: 'access', sub: 'admin-1', sid: 'sess-1' };

/**
 * The SESSION, not the token, is the authority on impersonation. Ending an
 * impersonation revokes the session, so a token minted a moment earlier must
 * stop working — which it only does if the principal is derived from the
 * session row on every request.
 */
describe('JwtStrategy impersonation', () => {
  it('gives an ordinary super-admin session no tenant context', async () => {
    const t = build();
    t.sessions.validateForAccess.mockResolvedValue(session());

    const principal = await t.strategy.validate(payload);
    expect(principal.companyId).toBeNull();
    expect(principal.impersonatorId).toBeNull();
  });

  it('takes the tenant context from the impersonation session', async () => {
    const t = build();
    t.sessions.validateForAccess.mockResolvedValue(
      session({ companyId: 'c1', impersonatorId: 'admin-1' }),
    );

    const principal = await t.strategy.validate(payload);
    expect(principal.companyId).toBe('c1');
    expect(principal.impersonatorId).toBe('admin-1');
    expect(principal.isSuperAdmin).toBe(true);
  });

  it('rejects an impersonation session that belongs to a different admin', async () => {
    const t = build();
    t.sessions.validateForAccess.mockResolvedValue(
      session({ companyId: 'c1', impersonatorId: 'someone-else' }),
    );
    await expect(t.strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an impersonation session once the admin has been demoted', async () => {
    // Otherwise a demoted admin keeps a token whose tenant context is another
    // company's, quietly becoming a member of a tenant they were never granted.
    const t = build();
    t.users.findById.mockResolvedValue({ ...ADMIN, role: 'COMPANY_ADMIN' });
    t.sessions.validateForAccess.mockResolvedValue(
      session({ companyId: 'c1', impersonatorId: 'admin-1' }),
    );
    await expect(t.strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('checks the IMPERSONATED company for suspension, not the admin own', async () => {
    // The admin companyId is null, so keying the check off the user row would
    // skip it entirely for the tenant actually being acted in.
    const t = build();
    t.companies.isSuspended.mockReturnValue(true);
    t.sessions.validateForAccess.mockResolvedValue(
      session({ companyId: 'c1', impersonatorId: 'admin-1' }),
    );
    await expect(t.strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a non-access token type', async () => {
    const t = build();
    await expect(t.strategy.validate({ ...payload, typ: 'refresh' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when the session belongs to another user', async () => {
    const t = build();
    t.sessions.validateForAccess.mockResolvedValue(session({ userId: 'someone-else' }));
    await expect(t.strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
