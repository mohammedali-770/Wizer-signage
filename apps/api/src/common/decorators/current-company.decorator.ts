import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';

import type { AuthenticatedUser } from '../types/auth.types';

/**
 * Injects the caller's `companyId`, taken from the verified token — never from
 * client input. Throws for a principal that has no company (a SUPER_ADMIN that
 * has not selected a target tenant); such handlers should resolve the target
 * company explicitly via an audited path instead.
 */
export const CurrentCompany = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const companyId = request.user?.companyId;
    if (!companyId) {
      throw new ForbiddenException('No tenant context for this request.');
    }
    return companyId;
  },
);
