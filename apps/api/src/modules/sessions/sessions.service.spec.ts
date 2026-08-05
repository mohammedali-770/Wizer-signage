import type { Session } from '@prisma/client';

import { REFRESH_GRACE_MS, SessionsService } from './sessions.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    session: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'target', companyId: 'c1' }),
    },
  };
  const config = { get: () => ({ sessionInactivityTimeoutMinutes: 30 }) };
  return { service: new SessionsService(prisma, config as any), prisma };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    userId: 'u1',
    companyId: 'c1',
    refreshTokenHash: 'hash-new',
    previousRefreshTokenHash: null,
    refreshRotatedAt: null,
    userAgent: null,
    ip: null,
    mfaSatisfied: true,
    lastActiveAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    revokedReason: null,
    createdAt: new Date(),
    ...overrides,
  } as Session;
}

/**
 * Refresh rotation replaces the stored hash the instant the endpoint succeeds,
 * and any non-matching token destroys the whole session as suspected theft.
 * That is right for real reuse — and wrong for the ordinary case where the
 * client never RECEIVED the rotated token (dropped response, app killed
 * mid-request, two tabs refreshing at once), which logged the user out and
 * recorded it as an attack.
 */
describe('SessionsService rotation grace', () => {
  it('keeps exactly one generation of history on rotation', async () => {
    const t = build();
    await t.service.rotate('sess-1', 'hash-2', new Date(), 'hash-1');

    expect(t.prisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-1' },
        data: expect.objectContaining({
          refreshTokenHash: 'hash-2',
          previousRefreshTokenHash: 'hash-1',
          refreshRotatedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('clears the history when no previous hash is supplied', async () => {
    const t = build();
    await t.service.rotate('sess-1', 'hash-2', new Date());
    expect(t.prisma.session.update.mock.calls[0][0].data.previousRefreshTokenHash).toBeNull();
  });

  it('accepts the immediately-previous token inside the window', () => {
    const t = build();
    const s = session({ previousRefreshTokenHash: 'hash-old', refreshRotatedAt: new Date() });
    expect(t.service.isWithinRotationGrace(s, 'hash-old')).toBe(true);
  });

  it('rejects it once the window has passed', () => {
    const t = build();
    const rotatedAt = new Date(Date.now() - REFRESH_GRACE_MS - 1_000);
    const s = session({ previousRefreshTokenHash: 'hash-old', refreshRotatedAt: rotatedAt });
    expect(t.service.isWithinRotationGrace(s, 'hash-old')).toBe(false);
  });

  it('rejects it exactly one millisecond past the boundary', () => {
    const t = build();
    const now = Date.now();
    const s = session({
      previousRefreshTokenHash: 'hash-old',
      refreshRotatedAt: new Date(now - REFRESH_GRACE_MS),
    });
    expect(t.service.isWithinRotationGrace(s, 'hash-old', now)).toBe(true);
    expect(t.service.isWithinRotationGrace(s, 'hash-old', now + 1)).toBe(false);
  });

  it('rejects a token two generations old — grace is one step, not a chain', () => {
    const t = build();
    const s = session({ previousRefreshTokenHash: 'hash-1', refreshRotatedAt: new Date() });
    expect(t.service.isWithinRotationGrace(s, 'hash-0')).toBe(false);
  });

  it('rejects any token on a session that has never rotated', () => {
    const t = build();
    expect(t.service.isWithinRotationGrace(session(), 'anything')).toBe(false);
  });

  it('rejects when the timestamp is missing even though a hash is stored', () => {
    const t = build();
    const s = session({ previousRefreshTokenHash: 'hash-old', refreshRotatedAt: null });
    expect(t.service.isWithinRotationGrace(s, 'hash-old')).toBe(false);
  });

  it('never publishes a refresh-token hash in the session view', () => {
    const t = build();
    const view = t.service.toView(
      session({ previousRefreshTokenHash: 'SECRET-PREV', refreshTokenHash: 'SECRET-CURRENT' }),
      'sess-1',
    );
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('SECRET-PREV');
    expect(serialized).not.toContain('SECRET-CURRENT');
    expect(view.current).toBe(true);
  });
});

/**
 * Session validation on every authenticated request. `validateForAccess` is the
 * gate that makes revocation real: without it a revoked or expired session's
 * access token keeps working until the JWT itself expires.
 */
describe('SessionsService.validateForAccess', () => {
  const unauthorized = /Session/i;

  it('accepts an active session', async () => {
    const { service, prisma } = build();
    prisma.session.findUnique.mockResolvedValue(session());
    await expect(service.validateForAccess('sess-1')).resolves.toBeDefined();
  });

  it('rejects a session that does not exist', async () => {
    const { service, prisma } = build();
    prisma.session.findUnique.mockResolvedValue(null);
    await expect(service.validateForAccess('nope')).rejects.toThrow(unauthorized);
  });

  it('rejects a revoked session', async () => {
    // The whole point of DB-backed sessions: a revoked session must stop
    // working immediately, not when its JWT happens to expire.
    const { service, prisma } = build();
    prisma.session.findUnique.mockResolvedValue(session({ revokedAt: new Date() }));
    await expect(service.validateForAccess('sess-1')).rejects.toThrow(unauthorized);
  });

  it('rejects and revokes an expired session', async () => {
    const { service, prisma } = build();
    prisma.session.findUnique.mockResolvedValue(
      session({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(service.validateForAccess('sess-1')).rejects.toThrow(unauthorized);
    expect(prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedReason: 'expired' }) }),
    );
  });

  it('rejects and revokes a session past the inactivity window', async () => {
    const { service, prisma } = build();
    prisma.session.findUnique.mockResolvedValue(
      session({ lastActiveAt: new Date(Date.now() - 31 * 60_000) }),
    );
    await expect(service.validateForAccess('sess-1')).rejects.toThrow(unauthorized);
    expect(prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedReason: 'inactivity' }) }),
    );
  });

  it('does not write lastActiveAt on every request', async () => {
    // One write per request would be ~12/screen/min of pure churn.
    const { service, prisma } = build();
    prisma.session.findUnique.mockResolvedValue(session({ lastActiveAt: new Date() }));
    await service.validateForAccess('sess-1');
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it('advances lastActiveAt once past the throttle', async () => {
    const { service, prisma } = build();
    prisma.session.findUnique.mockResolvedValue(
      session({ lastActiveAt: new Date(Date.now() - 5 * 60_000) }),
    );
    await service.validateForAccess('sess-1');
    expect(prisma.session.update).toHaveBeenCalled();
  });
});

describe('SessionsService revocation', () => {
  it('only revokes sessions that are still active', async () => {
    // `revokedAt: null` in the predicate keeps the original reason and
    // timestamp rather than overwriting them on a second call.
    const { service, prisma } = build();
    await service.revoke('sess-1', 'user_revoked');
    expect(prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ revokedAt: null }) }),
    );
  });

  it('scopes a company-wide revocation to that company', async () => {
    const { service, prisma } = build();
    await service.revokeAllForCompany('c1', 'suspended');
    expect(prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'c1' }) }),
    );
  });

  it("can keep the caller's own session when revoking the rest", async () => {
    const { service, prisma } = build();
    await service.revokeAllForUser('u1', 'password_changed', 'sess-keep');
    expect(prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 'sess-keep' } }),
      }),
    );
  });

  it('revokes every session when no exception is given', async () => {
    const { service, prisma } = build();
    await service.revokeAllForUser('u1', 'password_changed');
    const where = prisma.session.updateMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('id');
  });
});

describe('SessionsService.revokeOwn', () => {
  it('revokes a session the caller owns', async () => {
    const { service, prisma } = build();
    prisma.session.findUnique.mockResolvedValue(session({ userId: 'u1' }));
    await expect(service.revokeOwn('u1', 'sess-1')).resolves.toBeUndefined();
  });

  it("refuses to revoke another user's session", async () => {
    // A 404 rather than a 403: confirming the id exists would let one user
    // enumerate another's sessions.
    const { service, prisma } = build();
    prisma.session.findUnique.mockResolvedValue(session({ userId: 'someone-else' }));
    await expect(service.revokeOwn('u1', 'sess-1')).rejects.toThrow(/not found/i);
  });

  it('treats an already-revoked session as absent', async () => {
    const { service, prisma } = build();
    prisma.session.findUnique.mockResolvedValue(session({ userId: 'u1', revokedAt: new Date() }));
    await expect(service.revokeOwn('u1', 'sess-1')).rejects.toThrow(/not found/i);
  });
});

describe('SessionsService.terminateUserSessions', () => {
  it('lets an admin terminate a user in their own company', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValue({ id: 'target', companyId: 'c1' });
    await expect(
      service.terminateUserSessions({ companyId: 'c1', isSuperAdmin: false }, 'target'),
    ).resolves.toBe(0);
  });

  it('refuses a target in another company', async () => {
    // Cross-tenant session termination would be a denial-of-service against
    // another customer's users.
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValue({ id: 'target', companyId: 'other' });
    await expect(
      service.terminateUserSessions({ companyId: 'c1', isSuperAdmin: false }, 'target'),
    ).rejects.toThrow(/not found/i);
  });

  it('allows a Super Admin across tenants', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValue({ id: 'target', companyId: 'other' });
    await expect(
      service.terminateUserSessions({ companyId: null, isSuperAdmin: true }, 'target'),
    ).resolves.toBe(0);
  });

  it('refuses a target that does not exist', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.terminateUserSessions({ companyId: 'c1', isSuperAdmin: false }, 'ghost'),
    ).rejects.toThrow(/not found/i);
  });
});

describe('SessionsService.listActiveForUser', () => {
  it("marks the caller's current session", async () => {
    const { service, prisma } = build();
    prisma.session.findMany.mockResolvedValue([session({ id: 'a' }), session({ id: 'b' })]);
    const list = await service.listActiveForUser('u1', 'b');
    expect(list.map((s) => s.current)).toEqual([false, true]);
  });

  it('never exposes a refresh-token hash in the list', async () => {
    const { service, prisma } = build();
    prisma.session.findMany.mockResolvedValue([session()]);
    const [view] = await service.listActiveForUser('u1');
    expect(view).not.toHaveProperty('refreshTokenHash');
    expect(view).not.toHaveProperty('previousRefreshTokenHash');
  });
});
