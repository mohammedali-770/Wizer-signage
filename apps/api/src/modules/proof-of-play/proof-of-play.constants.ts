/**
 * Phase 9 proof-of-play tuning. Proof-of-play is derived ONLY from real player
 * events — never from heartbeat, sync status, or manifest generation.
 */

/** Max events accepted in a single device batch (offline flush is chunked). */
export const MAX_EVENTS_PER_BATCH = 200;

/**
 * How far back a buffered (offline) event may be back-dated and still accepted.
 * A device that was offline for days flushes when it reconnects; anything older
 * is almost certainly a clock problem and is dropped.
 */
export const BACKFILL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** Tolerated clock skew for "future" startedAt values before we reject them. */
export const FUTURE_SKEW_MS = 10 * 60 * 1000; // 10 minutes

/** Hard cap on rows returned by a single CSV export (keeps memory bounded). */
export const EXPORT_ROW_CAP = 50_000;

/** Map device event types → the persisted terminal/initial status. */
export const EVENT_STATUS = {
  ITEM_STARTED: 'STARTED',
  ITEM_COMPLETED: 'COMPLETED',
  ITEM_FAILED: 'FAILED',
  ITEM_SKIPPED: 'SKIPPED',
  ITEM_INTERRUPTED: 'INTERRUPTED',
} as const;

export type ProofOfPlayEventType = keyof typeof EVENT_STATUS;
