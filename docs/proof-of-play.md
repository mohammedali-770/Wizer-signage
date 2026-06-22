# Proof of Play (Phase 9)

Proof-of-play (PoP) records **what actually played on each screen** — derived
exclusively from real player playback events. It is the audit/reporting source of
truth for "did this content actually show, for how long, and did it succeed?"

> Proof-of-play is **never** inferred from heartbeat, sync status, schedule
> existence, or manifest generation. Only the Android player's own advancement
> loop produces these events.

## Heartbeat vs. sync status vs. proof-of-play

| Signal                      | Question it answers                                             | Source                  | Cadence                      |
| --------------------------- | --------------------------------------------------------------- | ----------------------- | ---------------------------- |
| **Heartbeat** (Phase 8)     | "Is the device alive and what is it doing right now?"           | Device timer            | ~60 s                        |
| **Sync status** (Phase 7)   | "Is the cache up to date / downloads healthy?"                  | Sync engine             | per sync cycle               |
| **Proof-of-play** (Phase 9) | "Which item actually played, when, for how long, success/fail?" | Player advancement loop | one record per item playback |

They are deliberately independent. A screen can be online (heartbeat) and fully
synced (sync status) yet still produce **no** proof-of-play if nothing is actually
playing — and that distinction matters for billing/audit.

## Event lifecycle

Each item playback gets a device-generated `playbackSessionId` (a UUID — the
idempotency key). The player emits:

- `ITEM_STARTED` — the item began rendering.
- exactly one terminal event:
  - `ITEM_COMPLETED` — played to its natural end.
  - `ITEM_FAILED` — render/decode error (carries `failureReason`).
  - `ITEM_SKIPPED` — could not play (offline + uncached); standalone event.
  - `ITEM_INTERRUPTED` — pre-empted by a new manifest (e.g. an emergency) before
    finishing.

The backend upserts one `ProofOfPlay` row per `playbackSessionId`: `ITEM_STARTED`
creates it (`status = STARTED`); the terminal event closes it (sets `endedAt`,
`durationMs`, final `status`). The upsert **never regresses** a terminal status
back to `STARTED`, and the first terminal state wins, so re-sent or out-of-order
events converge to the same row.

Each record captures: `sourceType` (SCHEDULE/FALLBACK/EMERGENCY/NONE),
`playbackSource` (LOCAL_CACHE/STREAMING_SIGNED_URL/TEXT/URL/PDF/UNKNOWN),
`contentType`, `startedAt`/`endedAt`, `durationMs`/`expectedDurationMs`,
`offlinePlayback`, `manifestVersion`, `itemSequence`, and soft references to
content/playlist/schedule/emergency-broadcast.

### Tenancy & trust

`companyId`, `screenId`, `deviceId`, and `locationId` are **derived server-side
from the device token** — the Android payload is never trusted for tenancy. A
device can only ever report for its own screen. Direct TEXT/URL emergency items
have no library `Content`, so the player reports `contentId = null` for them (the
emergency identity travels in `emergencyBroadcastId`).

## Offline buffered events

PoP must survive offline gaps. On the device:

- `ProofOfPlayQueue` — a **bounded, file-backed FIFO** buffer (default 1000
  events). When full, the **oldest** events are dropped (recent playback is the
  most valuable) so storage can never grow without limit.
- `ProofOfPlayReporter` — `report()` enqueues synchronously and is exception-safe;
  a periodic loop (and an opportunistic post-enqueue flush) drains the queue in
  batches of 100 while online. The flush is mutex-guarded so the periodic loop and
  the opportunistic flush can never double-send (and thus double-drop) a batch.
- **Reporting failure never stops playback.** `report()` only touches the local
  queue; all network work is best-effort on a background scope.

The backend accepts back-dated events within a **14-day** window (older = almost
certainly a clock problem → dropped) and rejects events dated more than 10 minutes
in the future (clock skew). Counts of accepted/rejected are returned; a single bad
event never fails the batch.

## API

### Device (DeviceAuthGuard, own screen only)

`POST /api/device/proof-of-play/events`

```jsonc
{
  "events": [
    {
      "eventType": "ITEM_STARTED",
      "playbackSessionId": "uuid",
      "startedAt": "2026-06-16T10:00:00.000Z",
      "contentId": "…",
      "sourceType": "SCHEDULE",
      "playbackSource": "LOCAL_CACHE",
      "contentType": "IMAGE",
      "itemSequence": 0,
      "manifestVersion": "…",
      "offlinePlayback": false,
    },
    {
      "eventType": "ITEM_COMPLETED",
      "playbackSessionId": "uuid",
      "startedAt": "…",
      "endedAt": "…",
      "durationMs": 9000,
    },
  ],
}
```

Returns `{ accepted, rejected }`. Single batch endpoint handles both online pushes
and flushed offline buffers; idempotent on `playbackSessionId`.

### Dashboard (JWT + `report:read`, Viewers included)

- `GET /api/proof-of-play` — paginated, filterable events.
- `GET /api/proof-of-play/summary` — counts by status, total duration, most-played
  content, screens with failures.
- `GET /api/proof-of-play/export.csv` — filtered CSV export (capped at 50k rows;
  cells are CSV-escaped and formula-injection-guarded).

Filters: `from`, `to`, `screenId`, `locationId`, `contentId`, `playlistId`,
`scheduleId`, `emergencyBroadcastId`, `status`, `sourceType`, `playbackSource`,
`offlineOnly`.

Only the device endpoint **creates** events; the dashboard endpoints are read-only.

## Reports dashboard

`/company/reports/proof-of-play` — date-range + screen + status + source filters,
summary stat cards (total/completed/failed/skipped/interrupted plays + total
duration), a paginated event table (emergency plays flagged), a most-played list,
and a one-click CSV export. Viewers can read it.

## Activity logs

Playback events are **not** written to Activity Logs (they live only in
`ProofOfPlay`). Activity Logs remain for administrative actions.

## Handoff to Phase 10

- **Excel / PDF export** and **scheduled report emails** are deferred to Phase 10.
  CSV export ships now.
- **Retention**: `ProofOfPlay` is append-heavy; the cleanup/retention job (e.g.
  keep N months) is a Phase 10 foundation. Indexes on `(companyId, startedAt)` and
  `(screenId, startedAt)` already support time-bounded queries and pruning.
