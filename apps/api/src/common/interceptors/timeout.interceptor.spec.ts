import { CallHandler, ExecutionContext, RequestTimeoutException } from '@nestjs/common';
import { firstValueFrom, of, throwError, TimeoutError } from 'rxjs';

import { TimeoutInterceptor } from './timeout.interceptor';

/**
 * The exemption list had no test, and shipped a defect the type system cannot
 * see: every pattern anchors on `(\/|$)`, but it was matched against
 * `request.url`, which on Express INCLUDES the query string.
 *
 * The import upload is `@Post()` on `@Controller('imports')` taking its type via
 * `@Query('type')` (imports.controller.ts:72,81), so its URL is always
 * `/api/imports?type=...`. After `imports` comes `?`, which is neither `/` nor
 * end-of-string -- so the exemption added FOR that route matched it never, while
 * matching `/imports/:id/commit` and `/imports/templates/:type`, which are short
 * handlers that should keep the 120s backstop.
 *
 * These cases are the real URLs the dashboard sends, not invented ones.
 */
describe('TimeoutInterceptor exemptions', () => {
  const interceptor = new TimeoutInterceptor();

  /** A context whose handler never emits, so only an exemption lets it finish. */
  function contextFor(method: string, url: string): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ url, method }) }),
    } as unknown as ExecutionContext;
  }

  const passthrough: CallHandler = { handle: () => of('ok') };

  /**
   * Exempt iff the interceptor returns the handler's stream untouched. A
   * non-exempt route is piped through `timeout()`, so the returned observable is
   * a different object; that difference is the observable signal here.
   */
  function isExempt(method: string, url: string): boolean {
    const source = of('ok');
    const handler: CallHandler = { handle: () => source };
    return interceptor.intercept(contextFor(method, url), handler) === source;
  }

  it('exempts the import upload, which always carries a query string', () => {
    expect(isExempt('POST', '/api/imports?type=SCREENS')).toBe(true);
    expect(isExempt('POST', '/api/imports?type=CONTENT')).toBe(true);
  });

  it('exempts the content upload and replace routes', () => {
    expect(isExempt('POST', '/api/content/upload')).toBe(true);
    expect(isExempt('POST', '/api/content/abc123/replace')).toBe(true);
  });

  it('keeps the backstop on the short import handlers', () => {
    // These are ordinary handlers; a bare /imports?(\/|$) wrongly exempted them.
    expect(isExempt('POST', '/api/imports/abc123/commit')).toBe(false);
    expect(isExempt('POST', '/api/imports/abc123/cancel')).toBe(false);
    expect(isExempt('GET', '/api/imports/templates/SCREENS')).toBe(false);
    expect(isExempt('GET', '/api/imports/abc123')).toBe(false);
  });

  it('does not exempt the import LIST, which shares the upload path', () => {
    // Same path as the upload, different method -- so the exemption is
    // POST-qualified rather than path-only.
    expect(isExempt('GET', '/api/imports')).toBe(false);
    expect(isExempt('GET', '/api/imports?pageSize=20')).toBe(false);
  });

  it('still exempts the streaming routes even with a query string', () => {
    // The same query-string hazard applied to the pre-existing patterns.
    expect(isExempt('GET', '/api/content/abc/download?inline=1')).toBe(true);
    expect(isExempt('GET', '/api/reports/exports?format=csv')).toBe(true);
    expect(isExempt('GET', '/api/downloads/android/app.apk')).toBe(true);
  });

  it('bounds an ordinary route', () => {
    expect(isExempt('GET', '/api/screens')).toBe(false);
    expect(isExempt('POST', '/api/auth/login')).toBe(false);
  });

  it('converts a TimeoutError into a 408 for a non-exempt route', async () => {
    const handler: CallHandler = {
      handle: () => throwError(() => new TimeoutError()),
    };
    await expect(
      firstValueFrom(interceptor.intercept(contextFor('GET', '/api/screens'), handler)),
    ).rejects.toBeInstanceOf(RequestTimeoutException);
  });

  it('passes a non-timeout error through unchanged', async () => {
    const boom = new Error('boom');
    const handler: CallHandler = { handle: () => throwError(() => boom) };
    await expect(
      firstValueFrom(interceptor.intercept(contextFor('GET', '/api/screens'), handler)),
    ).rejects.toBe(boom);
  });

  it('ignores non-http contexts', () => {
    const ctx = { getType: () => 'ws' } as unknown as ExecutionContext;
    expect(interceptor.intercept(ctx, passthrough)).toBeDefined();
  });
});
