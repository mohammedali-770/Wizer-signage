import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { type Observable, tap } from 'rxjs';

import type { AuthenticatedUser } from '../types/auth.types';

/**
 * Per-request timing for performance troubleshooting (Req 3).
 *
 * Logs only safe metadata — method, path, status, duration, and the
 * authenticated user/company IDs — NEVER request/response bodies, headers,
 * cookies, tokens, or query values (which can carry secrets).
 *
 * Defaults are production-safe:
 *  - SLOW requests (> PERF_SLOW_MS, default 1000ms) are always logged at WARN.
 *  - Every request is logged at LOG level ONLY when PERF_LOG_REQUESTS=true.
 *  - Health checks are never logged (noise).
 */
@Injectable()
export class PerfLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly logAll = process.env.PERF_LOG_REQUESTS === 'true';
  private readonly slowMs = Number(process.env.PERF_SLOW_MS ?? 1000);

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();

    const http = ctx.switchToHttp();
    const req = http.getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      user?: AuthenticatedUser;
    }>();
    const method = req.method ?? 'GET';
    // Strip the query string so logged paths never include filter values.
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];

    if (path === '/api/health' || path === '/api/health/ready') {
      return next.handle();
    }

    const start = Date.now();
    const finish = (): void => {
      const ms = Date.now() - start;
      const status = http.getResponse<{ statusCode?: number }>().statusCode ?? 0;
      const who = req.user
        ? ` company=${req.user.companyId ?? '-'} user=${req.user.userId ?? '-'}`
        : '';
      const line = `${method} ${path} ${status} ${ms}ms${who}`;
      if (ms >= this.slowMs) this.logger.warn(`SLOW ${line}`);
      else if (this.logAll) this.logger.log(line);
    };

    return next.handle().pipe(tap({ next: finish, error: finish }));
  }
}
