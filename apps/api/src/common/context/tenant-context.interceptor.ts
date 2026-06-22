import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

import type { AuthenticatedUser } from '../types/auth.types';
import { TenantContextService } from './tenant-context.service';

/**
 * Populates the request-scoped {@link TenantContextService} from the
 * authenticated principal (`req.user`) so downstream services/audit logging can
 * read the acting company/user. Runs after guards (which set `req.user`).
 *
 * Unauthenticated (public) requests simply pass through with no context.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      ip?: string;
      headers: Record<string, string | string[] | undefined>;
    }>();
    const user = request?.user;

    if (!user) {
      return next.handle();
    }

    const userAgent = request.headers['user-agent'];

    return new Observable((subscriber) => {
      this.tenantContext.run(
        {
          userId: user.userId,
          role: user.role,
          companyId: user.companyId,
          sessionId: user.sessionId,
          isSuperAdmin: user.isSuperAdmin,
          ip: request.ip,
          userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
        },
        () => {
          next.handle().subscribe(subscriber);
        },
      );
    });
  }
}
