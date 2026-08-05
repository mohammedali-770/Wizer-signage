import type { PageMeta } from './types';

/**
 * Pure helpers behind `useAllPages` (see use-api.ts).
 *
 * Twenty-two selectors across the dashboard fetched `?pageSize=100` and rendered
 * whatever came back. A tenant with 120 screens saw 100 of them and had NO
 * indication the other 20 existed — those screens could not be scheduled, added
 * to a group, or reported on at all. At 101 companies a Super Admin could not
 * invoice the newest customer. Nothing anywhere said "there is more".
 *
 * These functions are separated from the hook so the paging arithmetic — the
 * part that silently loses records when it is wrong — is testable without React.
 */

/** How many records one request asks for. */
export const PAGE_SIZE = 100;

/**
 * Hard ceiling on requests per resource. 20 x 100 = 2,000 records, which covers
 * any realistic tenant while bounding a bad `totalPages` (or a server that keeps
 * claiming there is more) to a fixed amount of work rather than an infinite loop
 * in a browser tab.
 *
 * Hitting it is REPORTED, never silent — that is the entire point of the change.
 */
export const MAX_PAGES = 20;

/** Append `page`/`pageSize` to a path that may already carry a query string. */
export function pageUrl(path: string, page: number, pageSize: number = PAGE_SIZE): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}page=${page}&pageSize=${pageSize}`;
}

/**
 * Should another request be made after receiving `meta`?
 *
 * Guards every way this loop can misbehave:
 *  - a `totalPages` of 0 or NaN (empty or malformed response) stops immediately
 *  - a page number that fails to advance stops, rather than refetching page 1
 *    forever
 *  - the ceiling stops it regardless of what the server claims
 */
export function hasMorePages(meta: PageMeta | undefined, fetched: number): boolean {
  if (!meta) return false;
  const totalPages = Number(meta.totalPages);
  if (!Number.isFinite(totalPages) || totalPages <= 1) return false;
  if (fetched >= MAX_PAGES) return false;
  return fetched < totalPages;
}

export interface PageSpan {
  /** Records actually loaded. */
  loaded: number;
  /** Records the server says exist, when it says. */
  total: number;
  /** True when `loaded` is short of `total` — the UI must say so. */
  truncated: boolean;
}

/**
 * Describe what was loaded versus what exists.
 *
 * `truncated` is what a selector renders a "refine your search" notice from. The
 * bug being fixed was not that a list was capped — it is that the cap was
 * invisible, so a missing screen looked like a screen that did not exist.
 */
export function describeSpan(loaded: number, meta: PageMeta | undefined): PageSpan {
  const total = Number(meta?.total);
  if (!Number.isFinite(total) || total < 0) {
    // No usable total: report what we have and claim nothing about the rest.
    return { loaded, total: loaded, truncated: false };
  }
  return { loaded, total, truncated: loaded < total };
}
