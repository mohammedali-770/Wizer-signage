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

/** An exemption. `method` omitted means every method. */
type ExemptRoute = { method?: string; pattern: RegExp };

/**
 * Routes that legitimately stream or take a long time and must NOT be cut off
 * mid-transfer (large media downloads, report/export rendering).
 *
 * Matched against the PATH ONLY -- `intercept` strips the query string first.
 * That is load-bearing, not tidiness: `request.url` on Express carries the query
 * string, and every pattern here anchors on `(\/|$)`, so a `?` where the pattern
 * expects `/` or end-of-string silently defeats the exemption. `/api/imports?type=X`
 * matched nothing at all until the path was isolated.
 */
const EXEMPT_PATTERNS: ExemptRoute[] = [
  { pattern: /\/download(\/|$)/ },
  { pattern: /\/downloads(\/|$)/ },
  { pattern: /\/exports?(\/|$)/ },
  { pattern: /\/content\/[^/]+\/(file|stream)/ },
  // Uploads, for the same reason as the download routes above: the body IS the
  // transfer, so a handler bound is a bound on the client's uplink. Content is
  // capped at 300MB (content.controller.ts) behind nginx's 300s proxy timeout;
  // at 120s this interceptor was the BINDING constraint, well under the 300s the
  // docblock above says it means to sit beneath. A slow uplink got a 408 from us
  // rather than finishing.
  { pattern: /\/content\/upload(\/|$)/ },
  { pattern: /\/content\/[^/]+\/replace(\/|$)/ },
  // ONLY the multipart upload, which is `@Post()` on `@Controller('imports')`
  // (imports.controller.ts:72) -- so exactly `/imports`, and POST-qualified
  // because `@Get()` on the same path is the ordinary list handler. The detail,
  // commit, cancel and template routes are short handlers and keep the backstop;
  // a bare `/imports?(\/|$)` exempted all of them and, because of the query
  // string, still missed the upload it was added for.
  { method: 'POST', pattern: /\/imports$/ },
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
    const path = (request?.url ?? '').split('?')[0] ?? '';
    const method = (request?.method ?? '').toUpperCase();
    if (
      EXEMPT_PATTERNS.some(
        (route) => (!route.method || route.method === method) && route.pattern.test(path),
      )
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      timeout(DEFAULT_TIMEOUT_MS),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          // Log the route, never the payload or query values.
          this.logger.error(
            `Request timed out after ${DEFAULT_TIMEOUT_MS}ms: ${request?.method ?? '?'} ${path}`,
          );
          return throwError(() => new RequestTimeoutException('The request took too long.'));
        }
        return throwError(() => error);
      }),
    );
  }
}
