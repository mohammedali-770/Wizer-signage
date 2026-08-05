import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ALLOW_WITHOUT_2FA_KEY } from '../decorators/allow-without-two-factor.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TwoFactorEnforcementGuard } from './two-factor.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

function context(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

/** Reflector answering per metadata key, so the two flags are independent. */
function guard(opts: { isPublic?: boolean; allowWithout2fa?: boolean } = {}) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === IS_PUBLIC_KEY) return opts.isPublic;
      if (key === ALLOW_WITHOUT_2FA_KEY) return opts.allowWithout2fa;
      return undefined;
    }),
  } as unknown as Reflector;
  return new TwoFactorEnforcementGuard(reflector);
}

const enrolling = { twoFactorRequired: true, mfaSatisfied: false };
const satisfied = { twoFactorRequired: true, mfaSatisfied: true };
const notRequired = { twoFactorRequired: false, mfaSatisfied: false };

/**
 * Mandatory 2FA. A Super Admin whose session has not satisfied it is confined
 * to the enrollment routes — so the interesting cases are the escapes, not the
 * happy path: an unflagged route must NOT be reachable mid-enrollment, and the
 * `@AllowWithoutTwoFactor()` set must not widen by accident.
 */
describe('TwoFactorEnforcementGuard', () => {
  it('blocks an ordinary route for a principal mid-enrollment', () => {
    expect(() => guard().canActivate(context(enrolling))).toThrow(ForbiddenException);
  });

  it('allows the enrollment routes flagged @AllowWithoutTwoFactor()', () => {
    expect(guard({ allowWithout2fa: true }).canActivate(context(enrolling))).toBe(true);
  });

  it('allows everything once the session has satisfied 2FA', () => {
    expect(guard().canActivate(context(satisfied))).toBe(true);
  });

  it('allows a principal for whom 2FA is not required', () => {
    expect(guard().canActivate(context(notRequired))).toBe(true);
  });

  it('skips public routes', () => {
    expect(guard({ isPublic: true }).canActivate(context(enrolling))).toBe(true);
  });

  it('passes through when there is no principal', () => {
    expect(guard().canActivate(context(undefined))).toBe(true);
  });

  it('throws a machine-readable code the dashboard can route on', () => {
    // The dashboard sends the user to the setup screen off this code. A plain
    // 403 string would strand them on an unexplained error page instead.
    try {
      guard().canActivate(context(enrolling));
      throw new Error('expected the guard to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: 'TWO_FACTOR_SETUP_REQUIRED',
      });
    }
  });

  it('checks the public flag before reading the principal', () => {
    // A public route must not depend on the shape of `request.user`.
    expect(guard({ isPublic: true }).canActivate(context(null))).toBe(true);
  });
});
