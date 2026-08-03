import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

/**
 * Upper bound on how long ANY request handler may run.
 *
 * Slightly under nginx's 300s proxy timeout so the API gives up first and we see
 * a clean 408 in our own logs instead of nginx's 504 with the Node work still
 * running behind it.
 */
const DEFAULT_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 120_000);

/**
 * Routes that legitimately stream or take a long time and must NOT be cut off
 * mid-transfer (large media downloads, report/export rendering). Matched against
 * the request path.
 */
const EXEMPT_PATTERNS: RegExp[] = [
  /\/download(\/|$)/,
  /\/downloads(\/|$)/,
  /\/exports?(\/|$)/,
  /\/content\/[^/]+\/(file|stream)/,
];

/**
 * Global request timeout.
 *
 * Without this a slow third party (Supabase Storage, SMTP) converts directly
 * into unbounded request occupancy: each stuck request holds a socket, a Node
 * handle and a pooled DB connection. nginx gives up at 300s but the Node work
 * continues, so the process accumulates zombie in-flight work until the event
 * loop and the Prisma pool saturate — one degraded dependency takes the whole
 * fleet's API down.
 *
 * This bounds the blast radius. It does NOT replace per-call timeouts on the
 * outbound requests themselves (see StorageService/MailService); it is the
 * backstop for everything that has none.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TimeoutInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<{ url?: string; method?: string }>();
    const url = request?.url ?? '';
    if (EXEMPT_PATTERNS.some((pattern) => pattern.test(url))) {
      return next.handle();
    }

    return next.handle().pipe(
      timeout(DEFAULT_TIMEOUT_MS),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          // Log the route, never the payload or query values.
          this.logger.error(
            `Request timed out after ${DEFAULT_TIMEOUT_MS}ms: ${request?.method ?? '?'} ${url.split('?')[0]}`,
          );
          return throwError(() => new RequestTimeoutException('The request took too long.'));
        }
        return throwError(() => error);
      }),
    );
  }
}
