import { ForbiddenException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';

import { UsersService } from './users.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    user: { findFirst: jest.fn(), count: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  };
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(0) };
  const service = new UsersService(prisma, sessions as any);
  return { service, prisma, sessions };
}

const superActor: any = {
  userId: 'admin-1',
  isSuperAdmin: true,
  companyId: null,
  role: 'SUPER_ADMIN',
};
const PAST = new Date(Date.now() - 86_400_000);

describe('UsersService — last-active-Super-Admin protection', () => {
  it('refuses to disable the last active Super Admin', async () => {
    const t = build();
    t.prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      companyId: null,
    });
    t.prisma.user.count.mockResolvedValue(0); // no OTHER active super admins

    await expect(t.service.setStatus(superActor, 'u1', UserStatus.DISABLED)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(t.prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows disabling a Super Admin when another active one remains', async () => {
    const t = build();
    t.prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      companyId: null,
    });
    t.prisma.user.count.mockResolvedValue(1);
    t.prisma.user.update.mockResolvedValue({
      id: 'u1',
      status: UserStatus.DISABLED,
      passwordHash: 'x',
    });

    await t.service.setStatus(superActor, 'u1', UserStatus.DISABLED);
    expect(t.prisma.user.update).toHaveBeenCalled();
    expect(t.sessions.revokeAllForUser).toHaveBeenCalled();
  });
});

describe('UsersService.recordFailedLogin', () => {
  it('starts a fresh count after a previous lock has expired', async () => {
    const t = build();
    const { locked } = await t.service.recordFailedLogin({
      id: 'u1',
      failedLoginCount: 7,
      lockedUntil: PAST,
      role: UserRole.VIEWER,
    } as any);
    expect(locked).toBe(false);
    expect(t.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ failedLoginCount: 1 }) }),
    );
  });

  it('never locks out the last active Super Admin', async () => {
    const t = build();
    t.prisma.user.count.mockResolvedValue(0); // this is the only active super admin
    const { locked } = await t.service.recordFailedLogin({
      id: 'u1',
      failedLoginCount: 6,
      lockedUntil: null,
      role: UserRole.SUPER_ADMIN,
    } as any);
    expect(locked).toBe(false);
    const call = t.prisma.user.update.mock.calls[0][0];
    expect(call.data.status).toBeUndefined(); // not set to LOCKED
  });
});

/**
 * LOCKED was an unenforced enum value.
 *
 * Every gate in the system tested `isLocked()`, which only looks at
 * `lockedUntil`. A user whose `status` is LOCKED with NO expiry — an indefinite,
 * administrative hold — therefore passed login, token validation, refresh, and
 * the 2FA challenge exactly like an active account.
 */
describe('UsersService.isBlocked', () => {
  const FUTURE = new Date(Date.now() + 60 * 60_000);

  const cases: Array<[string, { status: UserStatus; lockedUntil: Date | null }, boolean]> = [
    ['an active account', { status: UserStatus.ACTIVE, lockedUntil: null }, false],
    ['a disabled account', { status: UserStatus.DISABLED, lockedUntil: null }, true],
    [
      'an indefinite administrative lock (the hole this closes)',
      { status: UserStatus.LOCKED, lockedUntil: null },
      true,
    ],
    [
      'a failed-login lockout still in its window',
      { status: UserStatus.LOCKED, lockedUntil: FUTURE },
      true,
    ],
    [
      'a failed-login lockout whose window has elapsed (auto-unlock)',
      { status: UserStatus.LOCKED, lockedUntil: PAST },
      false,
    ],
    [
      'an active account with a stale future lock is still blocked',
      { status: UserStatus.ACTIVE, lockedUntil: FUTURE },
      true,
    ],
    ['an invited account is not blocked', { status: UserStatus.INVITED, lockedUntil: null }, false],
  ];

  it.each(cases)('%s', (_label, user, expected) => {
    expect(build().service.isBlocked(user as any)).toBe(expected);
  });

  it('leaves isLocked purely time-based so auto-unlock still works', () => {
    const t = build();
    // Status is LOCKED but the window elapsed — isLocked must say false, or the
    // account would never come back on its own.
    expect(t.service.isLocked({ lockedUntil: PAST } as any)).toBe(false);
    expect(t.service.isLocked({ lockedUntil: FUTURE } as any)).toBe(true);
  });
});
