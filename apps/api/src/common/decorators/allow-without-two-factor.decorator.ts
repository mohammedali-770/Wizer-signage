import { SetMetadata } from '@nestjs/common';

export const ALLOW_WITHOUT_2FA_KEY = 'allowWithoutTwoFactor';

/**
 * Marks a route reachable by an authenticated principal who still owes a 2FA
 * setup (e.g. a Super Admin logging in for the first time). Used for the 2FA
 * setup/enable endpoints, `auth/me`, and logout so the user can complete
 * enrollment. All other routes are blocked by the TwoFactorEnforcementGuard
 * until 2FA is satisfied.
 */
export const AllowWithoutTwoFactor = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_WITHOUT_2FA_KEY, true);
