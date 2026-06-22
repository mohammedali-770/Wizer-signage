import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser } from '../types/auth.types';

/**
 * Injects the authenticated principal (or one of its fields) into a handler.
 *
 * ```ts
 * findMe(@CurrentUser() user: AuthenticatedUser) {}
 * findMe(@CurrentUser('userId') userId: string) {}
 * ```
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);
