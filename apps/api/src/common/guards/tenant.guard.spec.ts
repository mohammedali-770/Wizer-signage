import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';

import { TenantGuard } from './tenant.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

function context(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function guard(isPublic: boolean | undefined): TenantGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
  return new TenantGuard(reflector);
}

/**
 * Defence in depth for tenant isolation. The real boundary is the
 * `companyId`-scoped query in each service; this refuses a principal that
 * cannot be scoped at all, before it reaches one.
 *
 * The case that matters is a non-super-admin whose `companyId` is null or
 * empty. `@CurrentCompany()` would hand that straight to a service, where a
 * `where: { companyId: undefined }` silently drops the predicate and returns
 * every tenant's rows.
 */
describe('TenantGuard', () => {
  it('allows a company-scoped principal', () => {
    expect(
      guard(false).canActivate(context({ role: UserRole.COMPANY_ADMIN, companyId: 'c1' })),
    ).toBe(true);
  });

  it('allows a Super Admin, who legitimately has no companyId', () => {
    expect(guard(false).canActivate(context({ role: UserRole.SUPER_ADMIN, companyId: null }))).toBe(
      true,
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('rejects a tenant principal whose companyId is %s', (_label, companyId) => {
    // The dangerous shape: scoped queries built from this would lose their
    // predicate entirely rather than match nothing.
    expect(() =>
      guard(false).canActivate(context({ role: UserRole.COMPANY_ADMIN, companyId })),
    ).toThrow(ForbiddenException);
  });

  it.each([
    UserRole.COMPANY_ADMIN,
    UserRole.LOCATION_MANAGER,
    UserRole.CONTENT_MANAGER,
    UserRole.VIEWER,
  ])('applies to %s, not just admins', (role) => {
    expect(() => guard(false).canActivate(context({ role, companyId: null }))).toThrow(
      ForbiddenException,
    );
  });

  it('skips public routes entirely', () => {
    expect(
      guard(true).canActivate(context({ role: UserRole.COMPANY_ADMIN, companyId: null })),
    ).toBe(true);
  });

  it('passes through when there is no principal', () => {
    // Either an auth guard already rejected, or the route is public. Throwing
    // here would convert a clean 401 into a confusing 403.
    expect(guard(false).canActivate(context(undefined))).toBe(true);
  });
});
