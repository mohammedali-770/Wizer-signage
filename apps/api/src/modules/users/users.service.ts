import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import { ACCOUNT_LOCK_MINUTES, ACCOUNT_LOCK_THRESHOLD, DEFAULT_PAGE_SIZE } from '@wizer/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { ListUsersQueryDto } from './dto/list-users.dto';

/** User view safe to return over the API (secrets stripped). */
export type UserView = Omit<User, 'passwordHash' | 'twoFactorSecret' | 'twoFactorPendingSecret'>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
  ) {}

  // --- Lookups (used by auth) --------------------------------------------

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim(), deletedAt: null },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  /**
   * Time-based lockout from failed logins.
   *
   * This is the AUTO-EXPIRING lock: `lockedUntil` in the future. It deliberately
   * ignores `status`, because `status` stays LOCKED after the window elapses
   * until the next successful login clears it — treating that stale value as a
   * lock would make the auto-unlock never happen.
   */
  isLocked(user: Pick<User, 'lockedUntil'>): boolean {
    return !!user.lockedUntil && user.lockedUntil.getTime() > Date.now();
  }

  /**
   * Whether an account may authenticate at all.
   *
   * `isLocked()` alone left a hole: a user whose `status` is LOCKED with NO
   * `lockedUntil` — an INDEFINITE, administrative lock, which is what setting
   * the status by hand or by a future admin action means — passed every check,
   * because the only test anywhere was the timestamp. LOCKED was effectively an
   * unenforced enum value.
   *
   * The three blocking states, in the order an operator would describe them:
   *  - DISABLED: deactivated, permanent until reactivated.
   *  - LOCKED with no expiry: held by an administrator.
   *  - Any status with `lockedUntil` in the future: failed-login lockout.
   *
   * INVITED is NOT blocked here: an invited user has no password hash, so they
   * cannot reach an authenticated path in the first place, and blocking them
   * would break invitation acceptance.
   */
  isBlocked(user: Pick<User, 'status' | 'lockedUntil'>): boolean {
    if (user.status === UserStatus.DISABLED) return true;
    if (user.status === UserStatus.LOCKED && !user.lockedUntil) return true;
    return this.isLocked(user);
  }

  // --- Login security state ----------------------------------------------

  /** Increment failed-login counter, locking the account at the threshold. */
  async recordFailedLogin(
    user: Pick<User, 'id' | 'failedLoginCount' | 'lockedUntil' | 'role'>,
  ): Promise<{ locked: boolean }> {
    // If a previous lock already elapsed, start a fresh allowance rather than
    // re-locking on the first attempt after expiry.
    const lockExpired = !!user.lockedUntil && user.lockedUntil.getTime() <= Date.now();
    const failedLoginCount = (lockExpired ? 0 : user.failedLoginCount) + 1;
    const data: Prisma.UserUpdateInput = { failedLoginCount, lockedUntil: null };
    let locked = false;

    if (failedLoginCount >= ACCOUNT_LOCK_THRESHOLD) {
      // Never lock out the last active Super Admin — the platform must remain
      // administrable (docs/security.md §7).
      const isLastSuperAdmin =
        user.role === UserRole.SUPER_ADMIN && (await this.countActiveSuperAdmins(user.id)) === 0;
      if (!isLastSuperAdmin) {
        data.lockedUntil = new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60_000);
        data.status = UserStatus.LOCKED;
        locked = true;
      }
    }

    await this.prisma.user.update({ where: { id: user.id }, data });
    return { locked };
  }

  /** Locations from `ids` that actually belong to `companyId` (non-deleted). */
  async getValidLocationIds(companyId: string | null, ids: string[]): Promise<string[]> {
    if (!companyId || ids.length === 0) return [];
    const rows = await this.prisma.location.findMany({
      where: { id: { in: ids }, companyId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Clear failures and stamp last login on a successful authentication. */
  async recordSuccessfulLogin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        status: UserStatus.ACTIVE,
      },
    });
  }

  // --- Passwords ----------------------------------------------------------

  /** Most recent password hashes, newest first (for reuse prevention). */
  async getRecentPasswordHashes(userId: string, take = 3): Promise<string[]> {
    const rows = await this.prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { passwordHash: true },
    });
    return rows.map((r) => r.passwordHash);
  }

  /** Set a new password hash, record history, optionally activate the user. */
  async setPassword(
    userId: string,
    passwordHash: string,
    opts: { activate?: boolean } = {},
  ): Promise<void> {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, lockedUntil: true },
    });

    const data: Prisma.UserUpdateInput = { passwordHash, mustResetPassword: false };

    // Clear a FAILED-LOGIN lockout. Someone who locked themselves out and then
    // reset their password would otherwise get a success page and still be
    // refused at login until the window elapsed, with neither screen explaining
    // why. The stale failedLoginCount also left them one attempt from re-locking.
    //
    // A time-based lock is the ONLY kind cleared here: an administrative lock is
    // `status = LOCKED` with no `lockedUntil`, and DISABLED is a status of its
    // own, so neither is reachable from this branch. Resetting your own password
    // must not be a way to reactivate an account an admin closed.
    if (current?.lockedUntil) {
      data.failedLoginCount = 0;
      data.lockedUntil = null;
      if (current.status === UserStatus.LOCKED) {
        // recordFailedLogin writes status=LOCKED *together with* lockedUntil.
        // Clearing only the timestamp would leave LOCKED with no expiry, which
        // isBlocked() reads as an indefinite administrative lock — turning a
        // 15-minute lockout into a permanent one. recordSuccessfulLogin resets
        // status for the same reason.
        data.status = UserStatus.ACTIVE;
      }
    }

    if (opts.activate) {
      data.status = UserStatus.ACTIVE;
      data.emailVerifiedAt = new Date();
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data }),
      this.prisma.passwordHistory.create({ data: { userId, passwordHash } }),
    ]);

    // Keep only the 5 most recent password hashes.
    const stale = await this.prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: 5,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.passwordHistory.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
    }
  }

  // --- Last-Super-Admin protection ---------------------------------------

  countActiveSuperAdmins(excludeUserId?: string): Promise<number> {
    return this.prisma.user.count({
      where: {
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
    });
  }

  /** Throw if the given operation would remove the last active Super Admin. */
  private async assertNotLastSuperAdmin(user: Pick<User, 'id' | 'role' | 'status'>): Promise<void> {
    if (user.role !== UserRole.SUPER_ADMIN || user.status !== UserStatus.ACTIVE) {
      return;
    }
    const others = await this.countActiveSuperAdmins(user.id);
    if (others === 0) {
      throw new ForbiddenException(
        'Cannot disable, delete, or demote the last active Super Admin.',
      );
    }
  }

  // --- Management (tenant-scoped) ----------------------------------------

  async list(actor: AuthenticatedUser, query: ListUsersQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));

    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (!actor.isSuperAdmin) {
      where.companyId = actor.companyId;
    } else if (query.companyId) {
      where.companyId = query.companyId;
    }
    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((u) => this.toView(u)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  /** Fetch a user within the actor's tenant, or 404 (cross-tenant -> 404). */
  async getScopedOrThrow(actor: AuthenticatedUser, id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user || (!actor.isSuperAdmin && user.companyId !== actor.companyId)) {
      throw new NotFoundException('User not found.');
    }
    return user;
  }

  async getView(actor: AuthenticatedUser, id: string): Promise<UserView> {
    return this.toView(await this.getScopedOrThrow(actor, id));
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateUserDto): Promise<UserView> {
    const target = await this.getScopedOrThrow(actor, id);

    // Only a Super Admin may grant or manage the SUPER_ADMIN role.
    if (
      (dto.role === UserRole.SUPER_ADMIN || target.role === UserRole.SUPER_ADMIN) &&
      !actor.isSuperAdmin
    ) {
      throw new ForbiddenException('Only a Super Admin can manage Super Admin accounts.');
    }

    // Last-Super-Admin protection on demotion or deactivation.
    const demoting = dto.role !== undefined && dto.role !== UserRole.SUPER_ADMIN;
    const deactivating = dto.status !== undefined && dto.status !== UserStatus.ACTIVE;
    if (demoting || deactivating) {
      await this.assertNotLastSuperAdmin(target);
    }

    // Keep companyId consistent with the SUPER_ADMIN (platform) boundary.
    let companyOverride: string | null | undefined;
    if (dto.role === UserRole.SUPER_ADMIN && target.role !== UserRole.SUPER_ADMIN) {
      companyOverride = null; // becomes platform-level
    } else if (
      target.role === UserRole.SUPER_ADMIN &&
      dto.role !== undefined &&
      dto.role !== UserRole.SUPER_ADMIN
    ) {
      // Demoting a platform Super Admin to a company role needs a target company,
      // which this endpoint cannot supply — reject to avoid an inconsistent state.
      throw new BadRequestException(
        'Demoting a Super Admin to a company role is not supported on this endpoint.',
      );
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.locale !== undefined) data.locale = dto.locale;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.twoFactorEnforced !== undefined) data.twoFactorEnforced = dto.twoFactorEnforced;
    if (companyOverride !== undefined) {
      data.company = companyOverride ? { connect: { id: companyOverride } } : { disconnect: true };
    }

    const updated = await this.prisma.user.update({ where: { id: target.id }, data });

    // Replace location assignments if provided — every location must belong to
    // the user's (post-transition) company; reject any cross-tenant id.
    if (dto.locationIds) {
      const effectiveCompanyId = companyOverride !== undefined ? companyOverride : target.companyId;
      await this.prisma.userLocation.deleteMany({ where: { userId: target.id } });
      if (dto.locationIds.length > 0) {
        const valid = await this.getValidLocationIds(effectiveCompanyId, dto.locationIds);
        if (valid.length !== dto.locationIds.length) {
          throw new BadRequestException(
            'One or more locations are invalid or not in this company.',
          );
        }
        await this.prisma.userLocation.createMany({
          data: valid.map((locationId) => ({ userId: target.id, locationId })),
          skipDuplicates: true,
        });
      }
    }

    // Force re-authentication if the role/status changed.
    if (dto.role !== undefined || (dto.status !== undefined && dto.status !== UserStatus.ACTIVE)) {
      await this.sessions.revokeAllForUser(target.id, 'account_updated');
    }

    return this.toView(updated);
  }

  async setStatus(actor: AuthenticatedUser, id: string, status: UserStatus): Promise<UserView> {
    const target = await this.getScopedOrThrow(actor, id);
    if (target.role === UserRole.SUPER_ADMIN && !actor.isSuperAdmin) {
      throw new ForbiddenException('Only a Super Admin can manage Super Admin accounts.');
    }
    if (status !== UserStatus.ACTIVE) {
      await this.assertNotLastSuperAdmin(target);
    }
    const updated = await this.prisma.user.update({ where: { id: target.id }, data: { status } });
    if (status !== UserStatus.ACTIVE) {
      await this.sessions.revokeAllForUser(target.id, `status_${status.toLowerCase()}`);
    }
    return this.toView(updated);
  }

  /** Clear a lockout (manual unlock). */
  async unlock(actor: AuthenticatedUser, id: string): Promise<UserView> {
    const target = await this.getScopedOrThrow(actor, id);
    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: {
        lockedUntil: null,
        failedLoginCount: 0,
        status: target.status === UserStatus.LOCKED ? UserStatus.ACTIVE : target.status,
      },
    });
    return this.toView(updated);
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    if (id === actor.userId) {
      throw new BadRequestException('You cannot delete your own account.');
    }
    const target = await this.getScopedOrThrow(actor, id);
    if (target.role === UserRole.SUPER_ADMIN && !actor.isSuperAdmin) {
      throw new ForbiddenException('Only a Super Admin can delete Super Admin accounts.');
    }
    await this.assertNotLastSuperAdmin(target);

    await this.prisma.user.update({
      where: { id: target.id },
      data: {
        status: UserStatus.DISABLED,
        deletedAt: new Date(),
        // Free the (globally-unique) email so the address can be re-invited.
        email: `deleted+${target.id}@deleted.invalid`,
      },
    });
    await this.sessions.revokeAllForUser(target.id, 'account_deleted');
  }

  /** Create a user from an accepted invitation (used by AuthService). */
  async createFromInvitation(input: {
    email: string;
    name: string;
    passwordHash: string;
    role: UserRole;
    companyId: string | null;
    locationIds?: string[];
  }): Promise<User> {
    const existing = await this.findByEmail(input.email);
    if (existing) {
      throw new ConflictException('A user with this email already exists.');
    }
    // Defense-in-depth: only attach locations that belong to the invite's
    // company (invalid/cross-tenant ids are dropped, not blocking acceptance).
    const validLocationIds = await this.getValidLocationIds(
      input.companyId,
      input.locationIds ?? [],
    );

    const user = await this.prisma.user.create({
      data: {
        email: input.email.toLowerCase().trim(),
        name: input.name,
        passwordHash: input.passwordHash,
        role: input.role,
        companyId: input.companyId,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        passwordHistory: { create: { passwordHash: input.passwordHash } },
        ...(validLocationIds.length > 0
          ? { locations: { create: validLocationIds.map((locationId) => ({ locationId })) } }
          : {}),
      },
    });
    return user;
  }

  toView(user: User): UserView {
    const { passwordHash: _p, twoFactorSecret: _s, twoFactorPendingSecret: _ps, ...view } = user;
    return view;
  }
}
