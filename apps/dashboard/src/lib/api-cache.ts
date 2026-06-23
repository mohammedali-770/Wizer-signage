/**
 * Shared client-side GET cache + in-flight dedup for useApiResource.
 *
 * Kept in its own module (no imports from api.ts / use-api.ts) so the API client
 * can invalidate it on a 401/logout without creating a circular import.
 *
 * SECURITY: this only ever holds the CURRENT session's own data (every request
 * is tenant-scoped server-side). It is cleared on login, logout, and 401 refresh
 * failure so it never leaks across users in the same browser tab.
 */

interface CacheEntry {
  data: unknown;
  ts: number;
}

export const apiCache = new Map<string, CacheEntry>();
export const apiInflight = new Map<string, Promise<unknown>>();

/**
 * Drop cached GET responses. With no argument clears everything (login/logout/
 * 401). With a path prefix, clears matching entries (after a mutation).
 */
export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    apiCache.clear();
    apiInflight.clear();
    return;
  }
  for (const key of [...apiCache.keys()]) {
    if (key.startsWith(prefix)) apiCache.delete(key);
  }
}
