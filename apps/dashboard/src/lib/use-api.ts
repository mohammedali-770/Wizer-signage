'use client';

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from './api';
import { apiCache as cache, apiInflight as inflight, invalidateApiCache } from './api-cache';

// Re-exported so existing imports (`from './use-api'`) keep working.
export { invalidateApiCache };

interface ApiResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

interface UseApiOptions {
  /** Cache freshness window in ms. Default 30s. Pass 0 to disable caching. */
  ttl?: number;
}

const DEFAULT_TTL = 30_000;

/**
 * Fetch a GET resource on mount (and whenever `path` changes), exposing
 * loading/error state and a manual `reload`.
 *
 * Performance behaviour:
 *  - **Client cache (TTL):** a fresh cached response (within `ttl`, default 30s)
 *    is served instantly with no network call — revisiting a page feels instant.
 *  - **Request dedup:** concurrent identical requests share one in-flight call.
 *  - **Keep-previous-data:** on `path` change the previous data stays visible
 *    while the new request loads (no blank flash).
 *  - `reload()` always bypasses the cache and refetches.
 */
export function useApiResource<T>(
  path: string | null,
  options?: UseApiOptions,
): ApiResourceState<T> {
  const ttl = options?.ttl ?? DEFAULT_TTL;

  const readFresh = useCallback(
    (p: string): T | null => {
      if (ttl <= 0) return null;
      const entry = cache.get(p);
      if (entry && Date.now() - entry.ts < ttl) return entry.data as T;
      return null;
    },
    [ttl],
  );

  const [data, setData] = useState<T | null>(() => (path ? readFresh(path) : null));
  const [loading, setLoading] = useState<boolean>(
    path !== null && (!path || readFresh(path) === null),
  );
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    if (path) {
      cache.delete(path);
      inflight.delete(path);
    }
    setNonce((n) => n + 1);
  }, [path]);

  useEffect(() => {
    if (path === null) return;
    let active = true;

    // Fresh cache hit → serve instantly, no network. (reload() deletes the entry
    // first, so a manual reload always falls through to a fetch.)
    const fresh = readFresh(path);
    if (fresh !== null) {
      setData(fresh);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    // NOTE: we intentionally do NOT clear `data` here — keep the previous value
    // visible while the new request is in flight (keep-previous-data).

    // Dedup concurrent identical GETs.
    let request = inflight.get(path) as Promise<T> | undefined;
    if (!request) {
      request = api.get<T>(path);
      const tracked = request as Promise<unknown>;
      inflight.set(path, tracked);
      void tracked.finally(() => {
        if (inflight.get(path) === tracked) inflight.delete(path);
      });
    }

    request
      .then((result) => {
        cache.set(path, { data: result, ts: Date.now() });
        if (active) setData(result);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Failed to load data.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [path, nonce, readFresh]);

  return { data, loading, error, reload };
}
