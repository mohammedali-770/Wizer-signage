# Screen Pairing Guide

Pairing is how a physical Android TV / Google TV device becomes a managed
**screen** inside a company's Wizer Signage account. Instead of typing
credentials on a TV remote, the device shows a short code that an administrator
enters once against a **screen profile** in the dashboard. After that the device
holds a token scoped to that one screen and begins fetching its playback manifest.

> Implemented in **Phase 6** (device-initiated pairing). For installing/building
> the app see [android-player.md](./android-player.md); for hardware caveats see
> [device-limitations.md](./device-limitations.md).

---

## The pairing flow end to end

```
   Device (Android TV)                          Dashboard (admin)
   ------------------                           -----------------
1. Install & open the app
2. POST /api/device/pairing/start
   → { code, pairingSecret, expiresAt }
3. App displays the code:  A7K9Q2
   (pairingSecret is kept private, never shown)
                                          4. Open the screen profile
                                             (Screens → a screen → Device pairing)
                                          5. "Pair device" → enter A7K9Q2
                                          6. POST /api/screens/:id/pair
                                             { pairingCode: "A7K9Q2" }
7. App polls GET /api/device/pairing/status?code=A7K9Q2
   with header  X-Pairing-Secret: <secret>
8. Once claimed → { status: "paired", deviceToken, screenId }
   (token issued ONCE; app stores it encrypted)
9. App uses  X-Device-Token  for
   GET /api/device/manifest  and  GET /api/device/config
10. App starts full-screen playback
```

### Step by step

1. **Install and open the app.** A freshly installed, unpaired device boots
   straight into the pairing screen.

2. **The app requests a code.** On first launch the player calls
   `POST /api/device/pairing/start` with its own generated `deviceId` (+ basic
   device info). The backend returns a short **pairing code**, a private
   **pairing secret**, and an `expiresAt` (10-minute TTL). The code is shown
   large on the TV; the **secret is stored locally and never displayed**.

3. **The admin opens the screen profile.** A user with `screen:manage`
   permission opens the screen's detail page in the company console and, under
   **Device pairing**, clicks **Pair device**. The dashboard — not the device —
   decides which screen the code maps to.

4. **The admin enters the code.** This calls `POST /api/screens/:id/pair` with
   `{ pairingCode }`. The backend validates the code (pending, unexpired,
   same-company context derived from the admin's token), binds it to that screen
   and company, and creates a pending device record. The device **never** chooses
   `companyId`/`screenId` — tenant scoping is enforced from the admin's verified
   token (see [multi-tenancy.md](./multi-tenancy.md)).

5. **The device collects its token.** The app polls
   `GET /api/device/pairing/status?code=…` with the `X-Pairing-Secret` header.
   Because the secret is required, knowing the public code alone is never enough
   to claim the token. Once the code is claimed, the backend **issues a device
   token exactly once**, returns it to the secret-holder, marks the device
   ACTIVE, and sets the screen ONLINE. The app stores the token in encrypted
   storage (see [android-player.md](./android-player.md) § "Token storage").
   Expired codes are re-minted and re-displayed automatically.

6. **The app plays content.** Using `X-Device-Token`, the player fetches
   `GET /api/device/manifest` (what to play now) and `GET /api/device/config`
   (screen settings + refresh cadence), then renders the manifest full-screen and
   refreshes on a cadence.

---

## Device token & security

- The **device token is separate from the user JWT** and is **scoped to one
  screen** — never dashboard APIs, the content library, schedule management, or
  any other company/screen.
- It authorizes the whole `/api/device/*` surface for that screen, not just the
  manifest: config, manifest, sync-plan, sync-status, entitled content download,
  heartbeat, crash-report, command poll/ack/result, screenshot upload,
  proof-of-play ingest, and the OTA update policy/result endpoints. An earlier
  version of this page listed only manifest and config, which understated what a
  stolen device token reaches.
- The backend stores only a **sha256 hash** of the token (never the raw value),
  validated by `DeviceAuthGuard`.
- The **pairing secret** gates status polling so the public code cannot be used,
  on its own, to steal a token.

---

## Pairing code properties

- **Short & user-friendly** — six characters from an unambiguous alphabet
  (visually confusing characters like `0`/`O`, `1`/`I` excluded).
- **Unique** — a code resolves to exactly one pending device.
- **Time-limited** — ~10 minutes; the app auto-requests a new one on expiry.
- **Single use** — consumed when claimed and when the token is issued.
- **Auditable** — `device.pairing_started`, `screen.paired`,
  `device.token_issued`, and `screen.unpaired` are written to the activity log
  (company-scoped where applicable).

---

## Re-pairing and unpairing

- **Unpair** from the screen detail page (`POST /api/screens/:id/unpair`) revokes
  the device token immediately (the Device row goes REVOKED, its token hash is
  cleared) and resets the screen to UNPAIRED. The device's **next manifest fetch
  returns 401**, so the app clears its local pairing and returns to the pairing
  screen. Use this when retiring a screen or moving hardware out of service.
- **Re-pair / replace** a device by pairing a new code into the same screen — one
  active device per screen, so re-pairing replaces (and invalidates) any prior
  device/token. This covers swapping a faulty device or relocating a TV.

All pair/unpair actions are permission-gated (`screen:manage`) and audited.

---

## Related documentation

- [android-player.md](./android-player.md) — installing/building the player,
  device-token security, and manifest consumption.
- [advanced-scheduling.md](./advanced-scheduling.md) — how the playback manifest
  the device fetches is resolved.
- [device-limitations.md](./device-limitations.md) — hardware constraints.
- [multi-tenancy.md](./multi-tenancy.md) — company/location scoping during pairing.
