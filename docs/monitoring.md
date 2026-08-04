# Monitoring, Heartbeat & Remote Actions (Phase 8)

Phase 8 adds device heartbeat + telemetry, live online/offline status, a fleet
monitoring dashboard, remote commands (force sync / refresh / restart / clear
cache / screenshot / reboot), and best-effort screenshots. It builds on the
Phase 6 device token and Phase 7 sync-status. Heartbeats are **not**
proof-of-play (that is Phase 9) and are **not** written to the activity log.

See [android-player.md](./android-player.md) and [offline-cache.md](./offline-cache.md).

---

## Heartbeat & telemetry

`POST /api/device/heartbeat` (DeviceAuthGuard) — the device reports, on a cadence
(default **60 s**): app/device/OS info, uptime, `playbackState`
(PLAYING/IDLE/BUFFERING/ERROR/OFFLINE_PLAYBACK), current content/playlist/schedule,
manifest version, `networkStatus`, a cache summary (size, free storage, cached
assets), `lastError`, and best-effort `capabilities`.

The backend, in one transaction: writes a **heartbeat-history** row (90-day
retention policy; the cleanup job is Phase 10), updates the **latest telemetry
snapshot** on `Device` (fast dashboard reads), and recomputes the screen's
status. It returns `{ ok, status, pendingCommands }` so the device knows whether
to poll for commands. Heartbeats are intentionally **not** logged to the activity
trail (too noisy).

## Status calculation

Live screen status is **derived on every read** from the last heartbeat (no
scheduler needed):

- **DISABLED / ARCHIVED / UNPAIRED / PAIRING** — authoritative; never overwritten.
- **OFFLINE** — paired but no heartbeat within `heartbeatIntervalSeconds × 3`
  (the configurable "missed heartbeats" threshold), or no heartbeat yet.
- **WARNING** — a fresh heartbeat reporting a player error, failed/partial sync,
  or a `lastError`.
- **ONLINE** — a fresh, clean heartbeat.

A heartbeat is positive proof of life, so receiving one flips
PAIRING/UNPAIRED/OFFLINE → ONLINE (only DISABLED/ARCHIVED are held). The dashboard
shows ONLINE / OFFLINE / WARNING / UNPAIRED / PAIRING / DISABLED / ARCHIVED.

## Device config (extended)

`GET /api/device/config` now also returns `heartbeatIntervalSeconds`,
`commandPollIntervalSeconds` (polling delivery — there is no WebSocket channel),
and `screenshots: { automaticEnabled, automaticIntervalMinutes }` (automatic
screenshots default **off** to avoid storage abuse; configurable via
`Company.settings.autoScreenshot`).

## Remote commands

`DeviceCommand` lifecycle: **PENDING → DELIVERED → RUNNING → SUCCEEDED/FAILED**
(or EXPIRED after a 5-min TTL / CANCELLED). Delivery is **polling-based**:

| Side      | Endpoint                                                                                                                          | Auth             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Dashboard | `POST /api/screens/:id/commands` (+ `/actions/{force-sync,refresh-manifest,restart-playback,clear-cache,take-screenshot,reboot}`) | `screen:command` |
| Dashboard | `GET /api/screens/:id/commands`, `GET /api/screens/:id/commands/:commandId`                                                       | `screen:read`    |
| Device    | `GET /api/device/commands/pending` (marks DELIVERED)                                                                              | device token     |
| Device    | `POST /api/device/commands/:id/ack` (→ RUNNING)                                                                                   | device token     |
| Device    | `POST /api/device/commands/:id/result` (→ SUCCEEDED/FAILED)                                                                       | device token     |

**RBAC:** Company Admin + Location Manager can issue commands (`screen:command`);
Viewer / Content Manager are read-only. **Tenant isolation:** a device only ever
fetches/acks/results commands for **its own screen** (token-scoped); admins only
issue commands to their **own company's** screens.

### Automatic refresh on content change (push, not just poll)

Editing a **playlist, schedule, or content** automatically dispatches a
`REFRESH_MANIFEST` to the company's paired screens (a `ManifestRefreshInterceptor`
on those controllers fires after any successful write). Screens therefore pick up
changes within one command-poll cycle (**~12 s**) instead of waiting for the
periodic manifest refresh (**~60 s**). The dispatch is **best-effort** (never
breaks the write), **deduped** server-side (a screen with a queued refresh is not
re-queued), and **idempotent** on the device (it re-resolves and compares the
manifest hash — a no-op if nothing changed). A dashboard **Force sync** is the
manual equivalent.

### Manifest hash & in-sync status

The playback manifest carries a stable `manifestHash` — a sha256 fingerprint of
_what plays_ (items + schedule/playlist/emergency identity + priority + message),
excluding volatile fields (`generatedAt`, rotating signed URLs). It changes only
when the effective configuration changes. The player reports the hash it last
applied (as its synced manifest version), so the screen detail page shows the
**current** manifest hash, what the **device** is synced to, and an **In sync /
Update pending** badge.

### Android command handling

The player polls every ~12 s, acks, executes, and reports a result. Handling is
modular (`CommandExecutor` + a `CommandActions` interface):

- **FORCE_SYNC / REFRESH_MANIFEST** — trigger an immediate `SyncManager` sync.
- **RESTART_PLAYBACK** — bump a restart epoch so the player restarts from item 1.
- **CLEAR_CACHE** — safe cleanup keeping the **current manifest + last-good**
  assets (never deletes the currently-playing file); `payload.full = true` also
  drops last-good. Then re-syncs.
- **TAKE_SCREENSHOT** — capture + upload (see below).
- **RELOAD_CONFIG** — re-fetch device config on the next sync.
- **UNPAIR_DEVICE** — clear the local token and return to pairing.
- **REBOOT_DEVICE** — **unsupported** on normal Android TV → returns FAILED with a
  clear reason (no crash; see limitations).

## Screenshots

- **Manual:** dashboard **Take screenshot** issues a `TAKE_SCREENSHOT` command;
  the device captures its own window and uploads it; the dashboard shows the
  latest screenshot on the screen detail page (+ history).
- **Automatic:** foundation only — `GET /device/config` carries the interval; the
  device can capture on that interval if enabled (default **off**).
- **Upload:** `POST /api/device/screenshots` (DeviceAuthGuard, multipart). Images
  are validated by magic bytes, stored under
  `companies/{companyId}/screens/{screenId}/screenshots/{ts}.jpg`, and read back
  via short-lived **signed URLs** (never public).

### Screenshot capability & limitation (not faked)

Capture uses **PixelCopy of the app's own window** (API 26+). This works for the
player's own content (image/text/web). It **cannot** silently capture arbitrary
system screens, and **video on a secure surface** may come back black — those
return FAILED with a clear reason. Full-fidelity capture would need
MediaProjection consent or system/device-owner privileges. On API < 26 or where
PixelCopy fails, the command reports **FAILED (unsupported)** — screenshots are
never fabricated.

## Dashboard

- **Fleet monitoring** `/{locale}/company/monitoring`: status counts (online /
  offline / warning / unpaired / failed-sync), alerts (offline + warning
  screens), and a screen table with status, playback, sync, app version, last
  heartbeat, and quick **Sync / Screenshot** actions.
- **Screen detail** gains a **Monitoring & control** card: live status,
  telemetry, latest screenshot, a remote-action panel (force sync / refresh /
  restart / clear cache / screenshot / reboot), and recent command history — plus
  the Phase 7 **Sync & cache** card.

## Alerts foundation

Basic alerts are **derived** in the monitoring overview (offline screens =
CRITICAL, warning screens = WARNING) and shown on the dashboard. A persistent
alert model + email/notification delivery is **Phase 10** (not built here).

## Activity logs

Dashboard-issued actions are logged (`device.command_force_sync`,
`device.command_take_screenshot`, …). Heartbeats and screenshot uploads are
**not** logged (too noisy).

## Troubleshooting online/offline

- A screen shows **OFFLINE** when no heartbeat arrived within ~3× the heartbeat
  interval — check device power/network, the API base URL, and the device token
  (a revoked token sends the player back to pairing).
- **WARNING** with failed/partial sync → check storage + the Phase 7 sync status;
  with a player error → check `lastError` in the telemetry.
- A **paired** screen with status OFFLINE counts toward "missing heartbeat".

## Handoff notes for Phase 9 (proof-of-play & emergency broadcast)

- **Proof-of-play** is a separate concern: log actual per-item play windows
  (start/end, duration, success) from the player's item-advancement loop into the
  existing `ProofOfPlay` model — do **not** reuse heartbeat/sync-status for this.
- **Emergency broadcast** runtime can reuse the command-delivery + manifest
  resolver: an active broadcast would pre-empt the schedule in the resolver and a
  high-priority command could force an immediate refresh. The `EmergencyBroadcast`
  schema already exists.
- The heartbeat history + `DeviceCommand` audit are the inputs a richer Phase 8+
  monitoring/reporting view (and Phase 10 alerts/notifications) will build on.
