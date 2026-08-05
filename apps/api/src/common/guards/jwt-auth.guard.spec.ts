import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { JwtAuthGuard } from './jwt-auth.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

function context(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as any;
}

function guard(isPublic: boolean | undefined): JwtAuthGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
  return new JwtAuthGuard(reflector);
}

/**
 * The global authentication guard.
 *
 * `canActivate` delegates to passport for the token check itself, so what is
 * worth testing here is the logic this class adds around it: the `@Public()`
 * short-circuit, and `handleRequest` — which is the piece that decides whether
 * a missing or failed principal becomes a 401 or is quietly allowed through.
 *
 * Passport calls `handleRequest(err, user, info)` and the DEFAULT
 * implementation throws on a falsy user. Overriding it is where an
 * authentication bypass is usually introduced, by returning `user` unchecked.
 */
describe('JwtAuthGuard', () => {
  describe('@Public() short-circuit', () => {
    it('allows a public route without consulting passport', () => {
      // If it fell through to super.canActivate() there would be no passport
      // strategy registered here and the call would throw.
      expect(guard(true).canActivate(context())).toBe(true);
    });
  });

  describe('handleRequest', () => {
    const g = guard(false);

    it('returns the principal when authentication succeeded', () => {
      const user = { userId: 'u1', role: 'VIEWER' };
      expect(g.handleRequest(null, user)).toBe(user);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['false', false],
      ['empty string', ''],
      ['zero', 0],
    ])('rejects a falsy principal (%s)', (_label, user) => {
      // The bypass this guards against: `return user` without the check hands
      // downstream guards `undefined`, and TenantGuard/PermissionsGuard both
      // treat "no user" as nothing to enforce.
      expect(() => g.handleRequest(null, user)).toThrow(UnauthorizedException);
    });

    it('rejects when passport reported an error, even with a user', () => {
      expect(() => g.handleRequest(new Error('token expired'), { userId: 'u1' })).toThrow(
        UnauthorizedException,
      );
    });

    it('surfaces the underlying reason for an Error', () => {
      expect(() => g.handleRequest(new Error('token expired'), null)).toThrow(/token expired/);
    });

    it('falls back to a generic message for a non-Error rejection', () => {
      // Passport can pass a plain object; `err.message` would be undefined and
      // produce an empty 401 body.
      expect(() => g.handleRequest({ reason: 'nope' }, null)).toThrow(/Authentication required/);
    });
  });
});
