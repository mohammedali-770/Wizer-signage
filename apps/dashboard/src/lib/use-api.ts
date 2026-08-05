'use client';

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from './api';
import { describeSpan, hasMorePages, PAGE_SIZE, pageUrl, type PageSpan } from './paginate';
import type { PageMeta, Paginated } from './types';
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

/** What `useAllPages` returns: the same shape as a single-page fetch, plus span. */
interface AllPagesState<T> extends ApiResourceState<Paginated<T>> {
  /** Records loaded vs records that exist. `truncated` means the UI must say so. */
  span: PageSpan;
}

/**
 * Fetch EVERY page of a paginated resource, not just the first.
 *
 * Twenty-two selectors used `useApiResource('/x?pageSize=100')` and rendered
 * whatever came back. A tenant with 120 screens saw 100 of them with nothing to
 * indicate the rest existed — those screens could not be scheduled, grouped, or
 * reported on, and a missing screen is indistinguishable from a screen that was
 * never created. At 101 companies a Super Admin could not invoice the newest
 * customer.
 *
 * Bounded at MAX_PAGES, and when the bound bites `span.truncated` is true so the
 * caller renders a notice. A cap is fine; a SILENT cap is the defect.
 *
 * Returns `Paginated<T>` rather than a bare array so existing call sites keep
 * reading `.items` and `.meta` unchanged.
 */
export function useAllPages<T>(path: string | null, options?: UseApiOptions): AllPagesState<T> {
  const ttl = options?.ttl ?? DEFAULT_TTL;
  const [data, setData] = useState<Paginated<T> | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const items: T[] = [];
        let meta: PageMeta | undefined;
        let page = 1;

        // Sequential, not parallel: page count is unknown until the first
        // response, and firing 20 speculative requests would cost every small
        // tenant 19 pointless round trips to save one large tenant some latency.
        do {
          const url = pageUrl(path, page, PAGE_SIZE);
          const fresh =
            ttl > 0 && cache.get(url) && Date.now() - cache.get(url)!.ts < ttl
              ? (cache.get(url)!.data as Paginated<T>)
              : null;
          const chunk = fresh ?? (await api.get<Paginated<T>>(url));
          if (!fresh) cache.set(url, { data: chunk, ts: Date.now() });
          if (!active) return;

          items.push(...(chunk.items ?? []));
          meta = chunk.meta;
          page += 1;
        } while (hasMorePages(meta, page - 1));

        if (!active) return;
        setData({ items, meta: { ...(meta as PageMeta), total: meta?.total ?? items.length } });
      } catch (err: unknown) {
        if (active) setError(err instanceof ApiError ? err.message : 'Failed to load data.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [path, nonce, ttl]);

  return { data, loading, error, reload, span: describeSpan(data?.items.length ?? 0, data?.meta) };
}
