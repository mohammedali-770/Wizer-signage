# Advanced Scheduling & Playback Manifest (Phase 5)

A **schedule** binds a **playlist** to one or more **targets** (screens, screen
groups, locations, or company-wide) over a date range, daily time window, and set
of weekdays, with a **priority** and a **type** (`NORMAL` or `CAMPAIGN`). The
**schedule resolver** turns all of a screen's schedules + fallbacks + working
hours into a single **playback manifest** that the Android player will consume in
Phase 6/7.

Everything is company-scoped; `companyId` is always derived from the verified
token, never from the client. Targets, playlists, and content are validated to
belong to the caller's company.

## Schedule data model

| field                             | notes                                                                |
| --------------------------------- | -------------------------------------------------------------------- |
| `name`, `description`             |                                                                      |
| `playlistId`                      | the playlist to play (required to activate)                          |
| `status`                          | `ACTIVE` \| `PAUSED` \| `ARCHIVED`                                   |
| `scheduleType`                    | `NORMAL` \| `CAMPAIGN`                                               |
| `priority`                        | integer, **higher wins** (default 0)                                 |
| `startDate` (required), `endDate` | calendar dates (time-of-day ignored)                                 |
| `startTime`, `endTime`            | `"HH:mm"`; `endTime < startTime` ⇒ **overnight**                     |
| `isAllDay`                        | when true, times are ignored                                         |
| `daysOfWeek`                      | `0=Sun … 6=Sat`; **empty ⇒ every day**                               |
| `timezone`                        | optional; falls back to screen → location → company                  |
| `recurrence`                      | JSON, future-ready (not evaluated yet)                               |
| targets                           | `SCREEN` / `SCREEN_GROUP` / `LOCATION` / `COMPANY` (soft `targetId`) |

A schedule may only be **ACTIVE** when it has a valid playlist (≥1 valid item) and
at least one target — enforced on create with `status: ACTIVE` and on resume.
Create it `PAUSED` to fill in details first.

## Validation rules

- `startDate` required; `endDate` (if present) must be on/after `startDate`.
- `startTime` and `endTime` are required unless `isAllDay`.
- Overnight windows (`endTime < startTime`) are supported and documented as
  wrapping past midnight; the **day-of-week match uses the window's start day**.
- `daysOfWeek` entries must be `0..6`; `priority` numeric.
- Targets must be same-company and (for screens/locations) not deleted.

## Priority & conflict resolution

The agreed global precedence ladder (highest → lowest):

```
Emergency Broadcast  >  Higher-priority schedule  >  Campaign  >  Normal  >  Fallback content
```

Emergency Broadcast is **schema/placeholder only** in Phase 5 (no runtime). Among
schedules that match a screen at a given instant, the winner is chosen by:

1. **`priority` descending** — a higher number always wins.
2. **`CAMPAIGN` before `NORMAL`** — breaks ties at equal priority.
3. **most recently updated** (`updatedAt` desc) — deterministic final tie-break.

`GET /schedules/conflicts` returns every overlapping ACTIVE pair with the shared
screen ids and the **winner** id. Two schedules conflict when their **target
screen sets intersect**, their **date ranges overlap**, and their **day/time
windows overlap** (overnight-aware). Conflict detection considers direct screen
targets, screen groups, locations, and company-wide targets by expanding each
target to the concrete set of screens it reaches. Conflicts are **warnings** — the
dashboard surfaces them but never blocks saving.

## Working-hours integration

Each screen resolves effective working hours as **screen → location →
company default** (`Company.settings.defaultWorkingHours`). When the current time
(in the screen's timezone) is **outside** active hours, the resolver applies the
configured `outsideHoursBehavior`:

| behavior         | manifest result                                         |
| ---------------- | ------------------------------------------------------- |
| `FALLBACK`       | resolves the fallback hierarchy; `sourceType: FALLBACK` |
| `BLACK_SCREEN`   | `sourceType: NONE`, no items                            |
| `CUSTOM_MESSAGE` | `sourceType: NONE`, `message` populated                 |
| `BLANK_SCREEN`   | `sourceType: NONE`, no items                            |

A screen with no working-hours config plays 24/7. The resolver evaluates this and
the Android player acts on the result — it is enforced end to end, not just stored.

`BLANK_SCREEN` and `BLACK_SCREEN` do the same thing; both exist because both are
already present in stored configuration. Neither powers the display off, and
neither ever did: `BLANK_SCREEN` was called `SLEEP` until the name was corrected,
since nothing in the player calls `PowerManager` and soft kiosk holds the screen
awake. The API still ACCEPTS `"SLEEP"` on read and treats it as `BLANK_SCREEN`,
because working hours are stored as JSON and no migration rewrote existing rows.

## Orientation warnings

A playlist's orientation profile (`LANDSCAPE` / `PORTRAIT` / `MIXED` / `UNKNOWN`)
is compared against each targeted screen's orientation. Mismatches (e.g. a
portrait playlist on a landscape screen) and mixed playlists raise **warnings** on
the schedule's validation view and in the manifest. Warning only — never blocks.

## The schedule resolver

`ScheduleResolverService.resolve(companyId, screenId, at?)` returns the manifest.
Order of evaluation:

1. **Gates** — company not `ACTIVE`, or screen `DISABLED`/`ARCHIVED` → `NONE`.
2. **Working hours** — outside hours → apply outside-hours behavior (above).
3. **Schedules** — ACTIVE schedules that target the screen and are active at `at`
   (date + day + time, per the schedule's timezone), sorted by the priority rules;
   the first whose playlist yields **≥1 valid item** wins (`sourceType: SCHEDULE`).
   Invalid content (expired/archived/trashed/deleted) is skipped with a warning.
4. **Fallback hierarchy** — screen → location → company `fallbackContentId`,
   validated ACTIVE + non-expired (`sourceType: FALLBACK`).
5. Nothing playable → `sourceType: NONE`.

## Playback manifest structure

`GET /api/screens/:id/playback-manifest?at=<ISO>` (permission `screen:read`). `at`
defaults to now — useful for "what will play now" previews in the dashboard.

```jsonc
{
  "screenId": "…",
  "generatedAt": "2026-06-15T12:00:00.000Z",
  "timezone": "Asia/Riyadh",
  "sourceType": "SCHEDULE", // SCHEDULE | FALLBACK | NONE
  "scheduleId": "…",
  "scheduleName": "Lunch promo",
  "playlistId": "…",
  "playlistTitle": "Lobby loop",
  "priority": 10,
  "outsideHours": false,
  "outsideHoursBehavior": null, // FALLBACK | BLACK_SCREEN | CUSTOM_MESSAGE | BLANK_SCREEN
  //   (legacy "SLEEP" is still accepted on read)
  "message": null,
  "items": [
    {
      "contentId": "…",
      "type": "IMAGE",
      "title": "Banner",
      "durationSeconds": 10,
      "playFullVideo": false,
      "pdfPageDurationSeconds": null,
      "orientation": "LANDSCAPE",
      "fileSizeBytes": "534210", // BigInt serialized as string
      "checksum": "…",
      "mimeType": "image/png",
      "signedUrl": "https://…", // short-lived; stored files only
      "url": null, // external URL content
      "textBody": null, // TEXT content
      "metadata": { "pageCount": null },
    },
  ],
  "warnings": ["Content is landscape but the screen is portrait."],
}
```

## Android player handoff notes (Phase 6/7)

- The manifest is **read-only** and **forward-looking** — Phase 5 does **not** build
  the player, offline cache, real heartbeat, screenshots, proof-of-play, or the
  emergency-broadcast runtime.
- `signedUrl`s are **short-lived** (default **1 hour**). For offline caching and
  long-running devices, Phase 6/7 should add a **device-authenticated download
  endpoint** (the player re-requests the manifest to refresh URLs, or fetches files
  through a device token). The manifest never exposes public, unrestricted storage
  URLs.
- `checksum` + `fileSizeBytes` are included so the player can verify and cache
  files; `durationSeconds`/`playFullVideo`/`pdfPageDurationSeconds` drive dwell
  time; `orientation` lets the player letterbox/rotate.
- The player should re-fetch the manifest periodically and on `at` boundaries
  (schedule start/end, working-hours edges) — schedule evaluation is timezone-aware
  server-side.

## API summary

`/api/schedules` — `schedule:read` (reads) / `schedule:manage` (writes):

| method   | path                                            | purpose                                                                            |
| -------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET`    | `/schedules`                                    | list (`status`, `scheduleType`, `targetType`, `dateFrom/To`, `priority`, `search`) |
| `POST`   | `/schedules`                                    | create (with optional `targets[]`)                                                 |
| `GET`    | `/schedules/conflicts`                          | all overlapping ACTIVE pairs + winner                                              |
| `GET`    | `/schedules/:id`                                | detail                                                                             |
| `GET`    | `/schedules/:id/validate`                       | schedulable? playlist/targets, orientation + conflict warnings                     |
| `PATCH`  | `/schedules/:id`                                | update                                                                             |
| `POST`   | `/schedules/:id/pause` · `/resume` · `/archive` | lifecycle                                                                          |
| `DELETE` | `/schedules/:id`                                | soft delete                                                                        |
| `POST`   | `/schedules/:id/targets`                        | add a target                                                                       |
| `DELETE` | `/schedules/:id/targets/:targetId`              | remove a target                                                                    |
| `GET`    | `/screens/:id/playback-manifest`                | resolve what plays now (or `?at=`)                                                 |

## Dashboard

`/{locale}/company/schedules` (list), `/new` (create form: playlist, type,
priority, dates, all-day/times, days-of-week, timezone, targets), and `/[id]`
(detail: edit, pause/resume/archive/delete, manage targets, a **validation** panel
with orientation + conflict warnings, and a **"preview what plays now"** that
resolves the manifest for a chosen screen).

## Activity log

`schedule.created/updated/paused/resumed/archived/deleted`,
`schedule.target_added/removed` — all company-scoped.

## How to test Phase 5

1. Create content (Content Library), then a **playlist**; add image/video/PDF items;
   set a video to full-play and another to a fixed duration; set a PDF page duration;
   reorder. Confirm total duration and orientation profile update, and that adding
   expired/archived content is blocked.
2. Create a **schedule** (paused), assign the playlist, add a screen + a company-wide
   target, set a daily window and weekdays, then **resume** — confirm activation is
   blocked without a valid playlist or targets.
3. Create a second overlapping schedule with a higher priority; open
   `GET /schedules/conflicts` (or the detail validation panel) and confirm the
   higher-priority one is the winner; flip the lower one to `CAMPAIGN` at equal
   priority and confirm campaign wins.
4. Open a screen's **playback-manifest** (or the dashboard "preview now"): confirm
   the scheduled playlist resolves with signed URLs, invalid content is skipped,
   and that outside working hours the configured behavior (fallback/black/message)
   is returned. Remove all schedules and confirm the **fallback hierarchy**
   (screen → location → company) resolves.
