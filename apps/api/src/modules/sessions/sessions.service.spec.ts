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
