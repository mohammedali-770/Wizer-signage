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

describe('UsersService.setPassword', () => {
  /** `current` is the row as it stands before the reset. */
  function buildWith(current: any = { status: UserStatus.ACTIVE, lockedUntil: null }) {
    const t = build();
    t.prisma.user.findUnique = jest.fn().mockResolvedValue(current);
    t.prisma.passwordHistory = {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    t.prisma.$transaction = jest.fn().mockResolvedValue([]);
    return t;
  }

  /** The `data` the service asked prisma to write to the user row. */
  function writtenData(t: any) {
    expect(t.prisma.user.update).toHaveBeenCalled();
    return t.prisma.user.update.mock.calls[0][0].data;
  }

  const FUTURE = new Date(Date.now() + 15 * 60_000);

  it('stores the new hash and drops the must-reset flag', async () => {
    const t = buildWith();
    await t.service.setPassword('u1', 'new-hash');
    expect(writtenData(t)).toMatchObject({ passwordHash: 'new-hash', mustResetPassword: false });
  });

  describe('after a failed-login lockout', () => {
    // recordFailedLogin writes BOTH `lockedUntil` and `status = LOCKED`.
    const lockedOut = { status: UserStatus.LOCKED, lockedUntil: FUTURE };

    it('clears the lockout window and the failure count', async () => {
      // `login` refuses while `lockedUntil` is in the future. Leaving it set
      // means the user gets a success page and is STILL refused at the login
      // screen, with nothing on either screen explaining why.
      const t = buildWith(lockedOut);
      await t.service.setPassword('u1', 'new-hash');
      expect(writtenData(t)).toMatchObject({ lockedUntil: null, failedLoginCount: 0 });
    });

    it('also returns the status to ACTIVE', async () => {
      // Clearing only the timestamp leaves `status = LOCKED` with no expiry,
      // which isBlocked() reads as an INDEFINITE administrative lock — strictly
      // worse than the 15-minute lockout it replaced.
      const t = buildWith(lockedOut);
      await t.service.setPassword('u1', 'new-hash');
      expect(writtenData(t).status).toBe(UserStatus.ACTIVE);
    });

    it('leaves the account unblocked afterwards', async () => {
      // Asserted through the real predicate, against the row as it will STAND
      // after the update — a partial write that omits `status` leaves the old
      // LOCKED value in the database, which reading the payload alone would
      // miss. A future change to isBlocked cannot silently re-strand these users.
      const t = buildWith(lockedOut);
      await t.service.setPassword('u1', 'new-hash');
      const resulting = { ...lockedOut, ...writtenData(t) };
      expect(t.service.isBlocked(resulting)).toBe(false);
    });
  });

  it('clears a stale future lock on an otherwise ACTIVE account', async () => {
    const t = buildWith({ status: UserStatus.ACTIVE, lockedUntil: FUTURE });
    await t.service.setPassword('u1', 'new-hash');
    expect(writtenData(t)).toMatchObject({ lockedUntil: null, failedLoginCount: 0 });
  });

  it('does not revive an indefinite administrative lock', async () => {
    // An admin lock is LOCKED with NO expiry. Resetting your own password must
    // not be a way to reopen an account an administrator closed.
    const t = buildWith({ status: UserStatus.LOCKED, lockedUntil: null });
    await t.service.setPassword('u1', 'new-hash');
    expect(writtenData(t)).not.toHaveProperty('status');
  });

  it('does not revive a disabled account', async () => {
    const t = buildWith({ status: UserStatus.DISABLED, lockedUntil: null });
    await t.service.setPassword('u1', 'new-hash');
    expect(writtenData(t)).not.toHaveProperty('status');
  });

  it('activates and marks the email verified only when asked', async () => {
    // The invitation-acceptance path, which legitimately does activate.
    const t = buildWith();
    await t.service.setPassword('u1', 'new-hash', { activate: true });
    const data = writtenData(t);
    expect(data.status).toBe(UserStatus.ACTIVE);
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('writes the user row and the history entry in one transaction', async () => {
    // A history write that lands without the password write (or vice versa)
    // corrupts the reuse check.
    const t = buildWith();
    await t.service.setPassword('u1', 'new-hash');
    expect(t.prisma.$transaction).toHaveBeenCalledWith(expect.any(Array));
    expect(t.prisma.passwordHistory.create).toHaveBeenCalledWith({
      data: { userId: 'u1', passwordHash: 'new-hash' },
    });
  });

  it('prunes history beyond the five most recent', async () => {
    const t = buildWith();
    t.prisma.passwordHistory.findMany.mockResolvedValue([{ id: 'h6' }, { id: 'h7' }]);

    await t.service.setPassword('u1', 'new-hash');
    expect(t.prisma.passwordHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5 }),
    );
    expect(t.prisma.passwordHistory.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['h6', 'h7'] } },
    });
  });

  it('does not issue a delete when there is nothing stale', async () => {
    const t = buildWith();
    await t.service.setPassword('u1', 'new-hash');
    expect(t.prisma.passwordHistory.deleteMany).not.toHaveBeenCalled();
  });
});
