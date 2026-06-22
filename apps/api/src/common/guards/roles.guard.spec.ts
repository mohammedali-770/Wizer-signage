import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';

import { RolesGuard } from './roles.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

function context(user: any): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function guardRequiring(required: UserRole[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard (Super-Admin-only endpoints)', () => {
  it('allows a Super Admin', () => {
    const guard = guardRequiring([UserRole.SUPER_ADMIN]);
    expect(guard.canActivate(context({ role: UserRole.SUPER_ADMIN }))).toBe(true);
  });

  it('blocks a non-Super-Admin (e.g. Company Admin)', () => {
    const guard = guardRequiring([UserRole.SUPER_ADMIN]);
    expect(() => guard.canActivate(context({ role: UserRole.COMPANY_ADMIN }))).toThrow(
      ForbiddenException,
    );
  });

  it('allows when no roles are required', () => {
    const guard = guardRequiring(undefined);
    expect(guard.canActivate(context({ role: UserRole.VIEWER }))).toBe(true);
  });
});
