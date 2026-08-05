import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeSpan, hasMorePages, MAX_PAGES, PAGE_SIZE, pageUrl } from './paginate.ts';

const meta = (over: Partial<Record<string, unknown>> = {}) =>
  ({ page: 1, pageSize: PAGE_SIZE, total: 100, totalPages: 1, ...over }) as never;

describe('pageUrl', () => {
  it('adds the query string when the path has none', () => {
    assert.equal(pageUrl('/screens', 1), '/screens?page=1&pageSize=100');
  });

  it('appends to an existing query string instead of starting a new one', () => {
    // `/playlists?status=ACTIVE?page=2` would be sent verbatim and silently
    // ignored by the API, quietly re-fetching page 1 forever.
    assert.equal(
      pageUrl('/playlists?status=ACTIVE', 2),
      '/playlists?status=ACTIVE&page=2&pageSize=100',
    );
  });

  it('carries the requested page number, not a fixed one', () => {
    assert.match(pageUrl('/screens', 7), /page=7/);
  });
});

describe('hasMorePages', () => {
  it('stops when there is only one page', () => {
    assert.equal(hasMorePages(meta({ totalPages: 1 }), 1), false);
  });

  it('continues while pages remain', () => {
    // The bug this fixes: a tenant with 120 screens has 2 pages, and stopping
    // after the first hides screens 101-120 with nothing to indicate it.
    assert.equal(hasMorePages(meta({ totalPages: 2 }), 1), true);
  });

  it('stops once every page has been fetched', () => {
    assert.equal(hasMorePages(meta({ totalPages: 2 }), 2), false);
  });

  it('stops at the ceiling however many pages the server claims', () => {
    // A bad totalPages must cost a bounded number of requests, not lock up the
    // tab.
    assert.equal(hasMorePages(meta({ totalPages: 10_000 }), MAX_PAGES), false);
  });

  it('fetches right up to the ceiling', () => {
    assert.equal(hasMorePages(meta({ totalPages: 10_000 }), MAX_PAGES - 1), true);
  });

  it('stops on a missing meta', () => {
    assert.equal(hasMorePages(undefined, 1), false);
  });

  it('stops on a zero totalPages', () => {
    assert.equal(hasMorePages(meta({ totalPages: 0 }), 1), false);
  });

  it('stops on a non-numeric totalPages rather than looping', () => {
    assert.equal(hasMorePages(meta({ totalPages: 'lots' }), 1), false);
    assert.equal(hasMorePages(meta({ totalPages: Number.NaN }), 1), false);
  });
});

describe('describeSpan', () => {
  it('reports a complete load as not truncated', () => {
    assert.deepEqual(describeSpan(120, meta({ total: 120 })), {
      loaded: 120,
      total: 120,
      truncated: false,
    });
  });

  it('flags a short load so the UI can say so', () => {
    // The whole point. A capped list that does not admit it turns a missing
    // screen into a screen the user believes does not exist.
    assert.deepEqual(describeSpan(2000, meta({ total: 5000 })), {
      loaded: 2000,
      total: 5000,
      truncated: true,
    });
  });

  it('claims nothing about the remainder when there is no usable total', () => {
    assert.deepEqual(describeSpan(30, undefined), { loaded: 30, total: 30, truncated: false });
    assert.deepEqual(describeSpan(30, meta({ total: 'many' })), {
      loaded: 30,
      total: 30,
      truncated: false,
    });
  });

  it('does not report truncation when more arrived than claimed', () => {
    // A stale total (rows added between requests) must not render as a negative
    // remainder or a spurious warning.
    assert.equal(describeSpan(120, meta({ total: 100 })).truncated, false);
  });

  it('handles an empty result', () => {
    assert.deepEqual(describeSpan(0, meta({ total: 0 })), {
      loaded: 0,
      total: 0,
      truncated: false,
    });
  });
});
