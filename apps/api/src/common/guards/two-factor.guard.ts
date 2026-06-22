import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ALLOW_WITHOUT_2FA_KEY } from '../decorators/allow-without-two-factor.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../types/auth.types';

/**
 * Enforces mandatory 2FA. A principal for whom 2FA is required but whose
 * session has not satisfied it (e.g. a Super Admin who has not yet enrolled) is
 * restricted to the routes flagged with `@AllowWithoutTwoFactor()` until they
 * complete enrollment. The response carries a stable code so the dashboard can
 * route the user into the 2FA setup screen.
 */
@Injectable()
export class TwoFactorEnforcementGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user || !user.twoFactorRequired || user.mfaSatisfied) {
      return true;
    }

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_2FA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    throw new ForbiddenException({
      code: 'TWO_FACTOR_SETUP_REQUIRED',
      message: 'Two-factor authentication setup is required before continuing.',
    });
  }
}
