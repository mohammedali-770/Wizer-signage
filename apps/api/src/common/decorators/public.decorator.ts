import { SetMetadata } from '@nestjs/common';

/** Metadata key marking a route as publicly accessible (skips JWT auth). */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route handler (or controller) as public — the global JwtAuthGuard
 * will not require an access token. Use for login, refresh, password reset,
 * invitation acceptance, 2FA login/enrollment, and health checks.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
