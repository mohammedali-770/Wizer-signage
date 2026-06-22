import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../types/auth.types';

/**
 * Defense-in-depth tenant guard. For authenticated, non-public routes it
 * ensures a non–super-admin principal actually carries a `companyId`. The
 * primary tenant isolation is the `companyId`-scoped queries in the service
 * layer; this guard simply refuses an inconsistent principal early.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    // No principal here means an auth guard already rejected, or the route is
    // public; nothing to enforce.
    if (!user) {
      return true;
    }

    if (user.role !== UserRole.SUPER_ADMIN && !user.companyId) {
      throw new ForbiddenException('Account is not associated with a company.');
    }
    return true;
  }
}
