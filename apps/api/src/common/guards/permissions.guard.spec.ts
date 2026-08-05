import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';

import { Permission } from '../rbac/permissions';
import { PermissionsGuard } from './permissions.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

function context(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function guardRequiring(required: Permission[] | undefined): PermissionsGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

/**
 * `@RequirePermissions(...)` enforcement — the check standing between a VIEWER
 * and every mutating route on the platform.
 *
 * The real `hasPermission` matrix is used rather than a mock: a guard that
 * consults a stubbed matrix proves only that it calls a function.
 */
describe('PermissionsGuard', () => {
  it('allows a role that holds the required permission', () => {
    const guard = guardRequiring([Permission.ScreenRead]);
    expect(guard.canActivate(context({ role: UserRole.VIEWER }))).toBe(true);
  });

  it('blocks a role that does not', () => {
    const guard = guardRequiring([Permission.UserUpdate]);
    expect(() => guard.canActivate(context({ role: UserRole.VIEWER }))).toThrow(ForbiddenException);
  });

  it('requires ALL listed permissions, not any', () => {
    // The decorator reads as a conjunction; an `some()` here would quietly
    // grant a route to anyone holding only its most common permission.
    const guard = guardRequiring([Permission.ScreenRead, Permission.UserUpdate]);
    expect(() => guard.canActivate(context({ role: UserRole.VIEWER }))).toThrow(ForbiddenException);
  });

  it('allows when every listed permission is held', () => {
    const guard = guardRequiring([Permission.ScreenRead, Permission.UserUpdate]);
    expect(guard.canActivate(context({ role: UserRole.COMPANY_ADMIN }))).toBe(true);
  });

  it.each([
    ['no metadata', undefined],
    ['an empty list', [] as Permission[]],
  ])('allows through when the route declares %s', (_label, required) => {
    // Routes opt in. Failing closed here would 403 every unannotated route,
    // including the ones guarded by @Roles instead.
    expect(guardRequiring(required).canActivate(context({ role: UserRole.VIEWER }))).toBe(true);
  });

  it('rejects a permissioned route with no principal', () => {
    // Should be unreachable behind JwtAuthGuard, but a guard ordering change
    // must not turn "no user" into "no checks".
    const guard = guardRequiring([Permission.ScreenRead]);
    expect(() => guard.canActivate(context(undefined))).toThrow(ForbiddenException);
  });

  it('does not leak which permission was missing', () => {
    // The message is deliberately generic: enumerating the required permission
    // hands an attacker a map of the authorization model.
    const guard = guardRequiring([Permission.UserUpdate]);
    expect(() => guard.canActivate(context({ role: UserRole.VIEWER }))).toThrow(
      /do not have permission/i,
    );
    expect(() => guard.canActivate(context({ role: UserRole.VIEWER }))).not.toThrow(/user:update/i);
  });
});
