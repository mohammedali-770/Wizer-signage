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

/**
 * Ceiling on a single item's reported playback duration.
 *
 * `durationMs` arrives from the device and is summed into the advertiser-billing
 * and compliance totals. The DTO bounds it below (`@Min(0)`) but nothing bounded
 * it above, so one event could carry an arbitrary integer and dominate every
 * total for that tenant — reachable by any holder of a device token, and also by
 * accident: an Android TV box has no RTC battery, and a build measuring duration
 * from the wall clock reports years when NTP lands mid-item.
 *
 * 24 hours is far beyond any real item (the longest is a video, and a looping
 * single-item playlist still emits one event per cycle) while staying obviously
 * finite. Values above it are clamped, not dropped: the playback DID happen, and
 * discarding the row would lose the record entirely.
 */
export const MAX_EVENT_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

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
