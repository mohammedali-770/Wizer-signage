import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { type Observable, tap } from 'rxjs';

import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ManifestRefreshService } from './manifest-refresh.service';

/**
 * After any SUCCESSFUL mutating (non-GET) request on a controller it is applied
 * to, pushes a REFRESH_MANIFEST to the company's screens so they re-resolve
 * promptly (Req 1). Applied at the class level to the content / playlists /
 * schedules controllers, so every current and future write path is covered
 * without instrumenting each service method.
 *
 * Fire-and-forget: the dispatch (ManifestRefreshService.refreshCompany) never
 * throws and is deduped/idempotent, so it does not delay or endanger the
 * response. Only runs on the success path (rxjs tap) — never after an error.
 */
@Injectable()
export class ManifestRefreshInterceptor implements NestInterceptor {
  constructor(private readonly refresh: ManifestRefreshService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{ method?: string; user?: AuthenticatedUser }>();
    const isMutation = (req.method ?? 'GET') !== 'GET';

    return next.handle().pipe(
      tap(() => {
        if (!isMutation) return;
        // companyId comes from the verified token, never client input. A
        // company-less principal (e.g. SUPER_ADMIN) safely dispatches nothing —
        // and on these tenant-scoped controllers @CurrentCompany would already
        // have rejected such a request before the handler ran.
        const companyId = req.user?.companyId;
        if (companyId) {
          void this.refresh.refreshCompany(companyId);
        }
      }),
    );
  }
}
