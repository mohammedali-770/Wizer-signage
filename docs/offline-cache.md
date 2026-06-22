# Offline Cache & Smart Sync (Phase 7)

Phase 7 lets the Android TV player keep playing during internet outages by
caching its entitled assets locally, persisting the last-good manifest, and
pre-downloading upcoming scheduled content. It adds three device-authenticated
backend endpoints (download, sync-plan, sync-status) and a modular Android cache
layer. Signed URLs remain in the manifest for online streaming only — the cache
is fed by the **device download endpoint**, never by public storage URLs.

See [android-player.md](./android-player.md) for the player and
[advanced-scheduling.md](./advanced-scheduling.md) for the manifest it consumes.

---

## Backend endpoints (all `DeviceAuthGuard`, device token, own screen only)

### `GET /api/device/content/:contentId/download`

Streams the bytes of an **entitled** content file to the device.

- **Entitlement is server-side.** The device may only download content that is
  entitled to **its own screen**: the current manifest, any schedule that could
  play within the pre-download window, or the screen → location → company
  fallback — and only while that content is `ACTIVE` and not
  expired/archived/trashed/deleted. An arbitrary or cross-company `contentId`
  returns **404**. companyId/screenId come from the verified device token, never
  the request.
- Correct `Content-Type`, `Accept-Ranges: bytes`, and **HTTP Range** support
  (206 + `Content-Range`) for resume / large video. `X-Content-Type-Options:
nosniff` + a strict CSP are set.
- For the Supabase adapter, the bytes are proxied server-side from a short-lived
  signed URL (the signed URL never leaves the API); the local adapter streams
  from disk. The Supabase service role stays server-side.

### `GET /api/device/sync-plan`

Returns the flat list of assets the device should keep cached:

```jsonc
{
  "screenId": "…",
  "generatedAt": "2026-06-16T12:00:00.000Z",
  "preDownloadWindowSeconds": 3600,
  "items": [
    {
      "contentId": "…",
      "type": "VIDEO",
      "title": "Promo",
      "fileSizeBytes": "9000000",
      "checksum": "…",
      "mimeType": "video/mp4",
      "orientation": "LANDSCAPE",
      "version": "2026-06-16T…",
      "durationSeconds": null,
      "playFullVideo": false,
      "pdfPageDurationSeconds": null,
      "downloadPath": "/device/content/…/download", // null for URL/TEXT
      "url": null,
      "textBody": null,
    },
  ],
}
```

The plan **includes** current-manifest assets, upcoming scheduled assets within
the **1-hour** pre-download window (evaluated at **1-minute** resolution across
the window, matching the schedule `HH:mm` granularity so no short schedule is
missed), and the fallback hierarchy. It **excludes** invalid content
(expired/archived/trash/deleted), **non-ACTIVE (DRAFT/archived) playlists**, and
anything cross-company. `checksum` + `fileSizeBytes` let the device verify
downloads and size its cache.

### `POST /api/device/sync-status`

The device reports its latest cache/sync snapshot (not a heartbeat). Stored on
the `Device` row and surfaced on the dashboard screen detail page:

```jsonc
{
  "status": "READY", // IDLE|SYNCING|READY|PARTIAL|FAILED|OFFLINE_PLAYBACK
  "manifestSource": "REMOTE", // REMOTE | LOCAL_CACHE
  "manifestVersion": "2026-06-16T…", // manifest generatedAt
  "requiredAssets": 4,
  "cachedAssets": 4,
  "failedDownloads": 0,
  "cacheSizeBytes": 12000000,
  "availableStorageBytes": 800000000,
  "lastError": null,
  "failedAssetIds": [],
}
```

### Manifest enhancement

Each file-backed manifest item now also carries `downloadPath` (the device
download endpoint) and `version` (content `updatedAt`), so the player prefers the
cache and can detect content changes. `signedUrl` remains for **online streaming
fallback** only.

---

## Android cache architecture

Modular, mostly File-injectable (so the cache is JVM-unit-testable):

| Class                        | Responsibility                                                  |
| ---------------------------- | --------------------------------------------------------------- |
| `data/model/SyncPlan`        | `SyncPlan` / `SyncPlanItem` / `SyncStatusReport` DTOs           |
| `data/cache/CacheModels`     | `CachedAsset`, `CacheIndex` (persisted)                         |
| `data/cache/CacheManager`    | atomic commit, index, lookup by id+version, size, cleanup       |
| `data/cache/AssetDownloader` | download → verify → atomic commit; retry/backoff                |
| `data/ManifestStore`         | persist the offline-safe last-good manifest                     |
| `data/ConnectivityObserver`  | network availability                                            |
| `data/SyncManager`           | orchestration (the engine); exposes the active manifest + state |
| `util/Checksums`             | SHA-256 verify (matches the backend's hex checksums)            |

Cached assets live under `filesDir/ms_cache/assets`; the index is
`cache_index.json`; the last-good manifest is `manifest_last_good.json`.

### Atomic, verified writes

Each asset is downloaded to a **temp file**, verified against the sync-plan's
`fileSizeBytes` + `checksum` (SHA-256), then **renamed into the final cache
path**; the index entry is only written after a successful commit. A failed or
corrupt download leaves any existing cached copy untouched. Downloads retry with
exponential backoff and skip work when the asset (by content id + **version**) is
already cached.

### Pre-download (smart sync, ~1 hour)

On each sync the device fetches the sync-plan and downloads its file assets,
**current-manifest assets first**, then upcoming/fallback. Assets scheduled to
play within the next hour are therefore cached before display time. If an asset
fails to cache before its schedule begins, the device reports `PARTIAL`/`FAILED`.

### Cache invalidation & cleanup

After a sync, the device keeps the **current manifest**, **sync-plan**, and
**last-good** assets and prunes everything else. The cache index is keyed by
**(contentId, version)**, so a superseded version's file survives (and stays
findable) until nothing references it. The **old playable cache is never deleted
until the new cache is ready**: the offline-safe last-good manifest is only
advanced once **all** of its file assets are cached, and cleanup's keep-set
(by content + version) always includes the current manifest, plan, and last-good. Corrupt/missing files are skipped at playback and
re-downloaded on the next sync.

---

## Online / offline playback behavior

**Online:** fetch config → manifest → sync-plan; download missing assets; show
the freshest manifest immediately (uncached items stream via `signedUrl`); prefer
the cached local file for any item that is ready; report sync status.

**Offline:** play the **last-good manifest** from cached files, looping
continuously. Only cache-playable items are shown (cached IMAGE/VIDEO/PDF + TEXT,
which is inline in the manifest). A missing/corrupt cached file is **skipped**.
If **no** cached content exists yet, a neutral **"No cached content available"**
local fallback screen is shown (never a black/error screen when cache exists).

**Manifest fetch fails (transient):** keep playing the current cached manifest
and retry on the next cycle (with the config-driven cadence). The screen is never
cleared.

**Token revoked (401):** clear the local pairing and return to the pairing
screen.

### URL content — offline limitation

URL (WebView) content is **not reliably cacheable** in Phase 7. While online it
plays in the WebView as before; **while offline it is skipped** (and a neutral
"Web content is unavailable offline" placeholder is used if it is ever reached).
Plan around this for screens that must run offline.

---

## Security / entitlement summary

- Device token is **screen-scoped**; it cannot read another screen's or another
  company's content, nor arbitrary same-company content that isn't current /
  upcoming / fallback for its screen.
- Entitlement is computed **server-side** from the verified token — the device
  never supplies companyId/screenId/contentId that is trusted without a check.
- Expired/archived/trashed/deleted content is never downloadable.
- No public/unrestricted storage URLs are exposed; the device token cannot reach
  dashboard/user endpoints.

---

## How to test offline playback

1. Pair a screen and assign a playlist/schedule (or a fallback) with image/video/
   PDF content. Let the player sync — the dashboard screen detail **Sync & cache**
   card should show `READY`, `Playing from: Online`, and a cached-asset count.
2. **Disconnect the network** on the device (or block the API). The player keeps
   looping the cached content; the card flips to `OFFLINE_PLAYBACK` /
   `Playing from: Offline cache` on its next report.
3. Confirm a **URL** item is skipped offline, and **TEXT** still shows.
4. Clear the app's cache (or use a fresh, never-synced device) and go offline →
   the **"No cached content available"** screen appears (no black/error screen).
5. Reconnect → the player resumes online sync; new/changed assets (by `version`)
   download, and unreferenced old assets are cleaned up.

Backend-only: with a device token, `GET /api/device/sync-plan`, then
`GET /api/device/content/{id}/download` (incl. a `Range:` header) for an entitled
asset; confirm a non-entitled or cross-company id returns **404**.

---

## Handoff notes for Phase 8 (monitoring / remote actions)

- The sync-status snapshot lives on `Device`; Phase 8 can layer a **heartbeat
  history** model + dashboard fleet view on top without changing the device API.
- `ConnectivityObserver`, `SyncManager`, and `CacheManager` are the seams for a
  future **remote "clear cache" / "refresh"** action (Phase 8) and richer
  telemetry (storage, current item, app version).
- Proof-of-play can reuse the player's per-item advancement; screenshots can
  capture the player surface — both are out of scope here.
