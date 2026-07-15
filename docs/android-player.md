# Android TV Player

The Wizer Signage Android TV Player is the native playback client that runs on
Android TV / Google TV devices at each physical screen. It pairs with a company
screen profile, downloads its assigned content and schedule, and plays it back
reliably, including while offline.

This document covers the technology stack, prerequisites, building, installing,
and the planned capability set per phase. For details on linking a device to a
screen profile see [pairing-guide.md](./pairing-guide.md). For OEM/hardware
caveats and the capability matrix see
[device-limitations.md](./device-limitations.md).

---

## Technology

| Concern            | Choice                                                |
| ------------------ | ----------------------------------------------------- |
| Language           | Kotlin 1.9.x                                          |
| UI toolkit         | Jetpack Compose (with Compose for TV / Leanback)      |
| Media playback     | Media3 ExoPlayer                                      |
| Build system       | Gradle 8 + Android Gradle Plugin (AGP) 8              |
| Application id     | `com.wizer-signage.player`                            |
| Min SDK            | 21 (Android 5.0 Lollipop)                             |
| Target SDK         | 34 (Android 14)                                       |
| Form factor        | Android TV / Google TV (Leanback launcher category)   |
| Dependency catalog | Gradle version catalog at `gradle/libs.versions.toml` |

The project lives at `apps/android-tv-player` within the Wizer Signage monorepo.
It is a standalone Gradle project and is intentionally not wired into the
Turborepo/pnpm JavaScript toolchain — it is built with Gradle, not pnpm.

---

## Prerequisites

- **Android Studio** (latest stable; Hedgehog or newer recommended) with the
  Android SDK Platform 34 and Android SDK Build-Tools installed.
- **JDK 17** — AGP 8 requires Java 17 to run Gradle. Ensure `JAVA_HOME` points at
  a JDK 17 installation, or use the JDK bundled with Android Studio.
- An **Android TV / Google TV device** (or the Android TV emulator image) for
  testing. A physical device is strongly recommended because emulators do not
  reproduce OEM kiosk/boot behavior (see
  [device-limitations.md](./device-limitations.md)).
- **adb** (Android Debug Bridge), included with the Android SDK platform-tools,
  for sideloading and remote debugging.

---

## Project location

```
apps/android-tv-player/
  settings.gradle.kts
  build.gradle.kts
  gradle/
    libs.versions.toml      # version catalog (Kotlin, Compose, Media3, AGP, ...)
  app/
    build.gradle.kts
    src/main/...
```

All commands below assume your working directory is
`apps/android-tv-player`.

---

## Gradle wrapper

The wrapper scripts (`gradlew`, `gradlew.bat`) and `gradle/wrapper/gradle-wrapper.properties`
(pinned to **Gradle 8.7**) **are committed**, so developers do **not** need a
globally installed Gradle — with one exception: the small binary
`gradle/wrapper/gradle-wrapper.jar` is **not** committed (it is a binary the
bootstrap script loads). Provision it once, either way:

- **Android Studio** — open `apps/android-tv-player`; on first sync Studio
  generates `gradle-wrapper.jar` automatically. Nothing else to do.
- **CLI (one-time)** — with any locally installed Gradle:

  ```bash
  cd apps/android-tv-player
  gradle wrapper --gradle-version 8.7
  ```

After the jar exists, always invoke the wrapper (`./gradlew` / `gradlew.bat`) —
it downloads and uses the pinned Gradle 8.7, so no global Gradle is required for
subsequent builds.

---

## Configuring the API base URL

The player reads the backend base URL from `BuildConfig.API_BASE_URL`, declared
in `app/build.gradle.kts`:

```kotlin
buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3001/api\"")
```

- `10.0.2.2` is the **Android emulator's** alias for the host machine, so the
  default targets a dev API running on the host at port 3001.
- For a **physical TV on your LAN**, change it to your machine's LAN IP, e.g.
  `http://192.168.1.20:3001/api` (the bundled `network_security_config.xml`
  permits cleartext to `localhost`, `10.0.2.2`, and common `192.168.x` ranges
  for dev only).
- For **production**, point it at the public **HTTPS** API URL. Cleartext is
  disallowed by default outside the dev allow-list.

Change the value (or wire it to a build flavour / `local.properties`) and rebuild.

---

## Local build verification (real Android dev machine)

Prerequisites: **JDK 17** (`java -version` → 17; AGP 8.5 requires it) and the
**Android SDK Platform 34** + Build-Tools (installed by Android Studio). Then,
from `apps/android-tv-player` (after the wrapper jar exists — see above):

```bash
# JVM unit tests (manifest parsing, playback duration/sequencing)
./gradlew test

# Build the debug APK
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk

# Instrumented tests (DeviceStore round-trip + legacy migration) — needs a
# running emulator/device (API 23+ exercises the encrypted path)
./gradlew connectedDebugAndroidTest
```

On Windows use `gradlew.bat` instead of `./gradlew`.

## Building an APK

### Debug build

```bash
cd apps/android-tv-player
./gradlew assembleDebug
```

Output:

```
apps/android-tv-player/app/build/outputs/apk/debug/app-debug.apk
```

Debug APKs are signed with the auto-generated debug keystore and are fine for
local sideloading and development.

### Release build

```bash
cd apps/android-tv-player
./gradlew assembleRelease
```

Output:

```
apps/android-tv-player/app/build/outputs/apk/release/app-release.apk
```

Release builds must be signed with a real release keystore for distribution and
in-app updates. The signing config is supplied via Gradle properties / a
keystore file kept out of source control. An unsigned release build lands as
`app-release-unsigned.apk` — sign it before distribution.

On Windows PowerShell, use `.\gradlew.bat assembleRelease` instead of
`./gradlew`.

---

## Sideloading / installing on a device

Android TV / Google TV devices do not have a file manager workflow like a
phone, so installation is done over the network with adb.

1. **Enable Developer options & USB/network debugging** on the TV
   (Settings -> Device Preferences -> About -> click Build several times, then
   enable "USB debugging" / "Network debugging").

2. **Connect to the device over the network** (find its IP under
   Settings -> Network):

   ```bash
   adb connect 192.168.1.50:5555
   ```

   The first connection prompts an "Allow debugging" dialog on the TV — accept
   it. (USB connection via `adb devices` also works if the device is cabled.)

3. **Install the APK:**

   ```bash
   adb install -r apps/android-tv-player/app/build/outputs/apk/release/app-release.apk
   ```

   `-r` reinstalls/updates while keeping app data. Use `-r -d` to allow a
   version-code downgrade during testing.

4. **Launch it** (it also appears in the Android TV launcher under "Apps"):

   ```bash
   adb shell monkey -p com.wizer-signage.player -c android.intent.category.LAUNCHER 1
   ```

On first launch the app displays a pairing code — continue with
[pairing-guide.md](./pairing-guide.md).

---

## Phase 6 — Player foundation (implemented)

### App structure

```
app/src/main/java/com/wizer-signage/player/
  MainActivity.kt            # immersive full-screen host; routes pairing ↔ player
  PlayerContainer.kt         # manual DI: ApiClient + DeviceStore + PairingRepository
  data/
    ApiClient.kt             # OkHttp + kotlinx.serialization device API client
    DeviceStore.kt           # local state (SharedPreferences) — see "Token storage"
    PairingRepository.kt      # pairing flow + manifest/config access
    model/                   # @Serializable Manifest / Pairing / DeviceConfig
  ui/
    pairing/                 # PairingViewModel + PairingScreen (code + status)
    player/                  # PlayerViewModel + PlayerScreen + content Renderers
  util/
    Playback.kt              # pure duration/sequencing logic (unit-tested)
    PdfRendering.kt          # first-page PDF → bitmap (framework PdfRenderer)
```

### Pairing flow (device-initiated)

1. On first run the player calls `POST /api/device/pairing/start` with its
   self-generated `deviceId` + device info. The backend returns a short,
   human-friendly **code**, an `expiresAt` (10 min), and a **private pairing
   secret**. The code is shown large on the TV; the secret is stored locally and
   never displayed.
2. A Company Admin opens the screen profile in the dashboard and enters the code
   (**Pair device**). The backend binds the code to that screen + company and
   creates a pending `Device` row. The Android app **never** chooses the company
   or screen — the dashboard decides.
3. The player polls `GET /api/device/pairing/status?code=…` with the
   `X-Pairing-Secret` header. Once claimed, the backend issues a **device token**
   (once), returns it to the holder of the secret, and the app stores it. Expired
   codes are re-minted automatically.

See [pairing-guide.md](./pairing-guide.md) for the operator's view.

### Device token security

- The device token is **separate from the user JWT** and is **scoped to one
  screen**. It only authorizes `GET /api/device/manifest` and
  `GET /api/device/config` for its own screen — never dashboard APIs, the content
  library, schedule management, or any other company/screen.
- The backend stores only a **sha256 hash** of the token (never the raw value).
  `DeviceAuthGuard` validates the `X-Device-Token` (or `Authorization: Bearer`)
  header against that hash.
- **Unpairing** from the dashboard revokes the token immediately; the next
  manifest fetch returns `401`, and the app clears local pairing and returns to
  the pairing screen.

### Playback manifest consumption

- The player fetches `GET /api/device/manifest` with the device token and parses
  the Phase 5 manifest (`sourceType`, `items[]`, `outsideHours`, `warnings`, …).
  Unknown fields are ignored, so additive backend changes don't break old apps.
- It refreshes on a cadence (`DeviceConfig.manifestRefreshIntervalSeconds`,
  default **60s**), and immediately after pairing. Transient network errors keep
  the **last good** manifest on screen (there is **no offline cache yet** — that
  is Phase 7; the app does not fake it).
- **Signed URLs are short-lived** (≈1 hour). The player re-fetches the manifest
  to refresh them. Long-running offline caching in Phase 7 will need a
  **device-authenticated download endpoint** (see handoff notes below).

### Supported content types

| Type  | Rendering                                                                     | Duration                                                 |
| ----- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| IMAGE | Coil, letterboxed full-screen                                                 | item duration (default 10s)                              |
| VIDEO | Media3 ExoPlayer                                                              | full length when `playFullVideo`/duration 0, else custom |
| TEXT  | full-screen typography                                                        | item duration                                            |
| URL   | full-screen WebView                                                           | item duration                                            |
| PDF   | **first page** via framework `PdfRenderer`                                    | item duration                                            |
| —     | `sourceType: FALLBACK` → fallback item(s); `NONE` → neutral / black / message | —                                                        |

### Token storage (security)

The device token, pairing secret, paired screen id, and device id are stored
**encrypted at rest** via Jetpack Security `EncryptedSharedPreferences` (AES-256;
the master key lives in the **Android Keystore**), all behind the single
`DeviceStore` abstraction.

- **API version note:** Keystore-backed `EncryptedSharedPreferences` requires
  **API 23+** (Android 6.0). On API 21–22 — or if Keystore initialisation fails —
  `DeviceStore` transparently **falls back to plain `SharedPreferences`** (logged
  once via `isSecureStorage = false`). Most Android TV / Google TV devices run
  API 23+, so encryption is the norm.
- **Migration:** on first run after upgrading from the Phase-6 plaintext build,
  `DeviceStore` copies any legacy values from the old plaintext file into the
  encrypted store and then **wipes the plaintext file**.

### Offline cache & smart sync (Phase 7)

Implemented — see **[offline-cache.md](./offline-cache.md)** for the full
architecture, the device download/sync-plan/sync-status endpoints, pre-download
behavior, cache verification/cleanup, the URL-offline limitation, and how to
test offline playback. In short: the player caches its entitled assets via a
device-authenticated download endpoint, persists a last-good manifest, pre-loads
upcoming scheduled content (~1h), keeps playing from cache when offline, and
reports sync/cache status to the dashboard.

### Known limitations (Phase 6/7)

- No real heartbeat, screenshots, proof-of-play, remote actions, or
  emergency-broadcast runtime (Phase 8+).
- No full kiosk mode (auto-start on boot has since been implemented — see
  "Auto-start on boot" below).
- No in-app APK auto-update.
- **URL (WebView) content is not cached** — it is skipped when offline.
- PDF shows the **first page only** (no multi-page rotation yet).
- Secrets are encrypted on API 23+; **API 21–22 falls back to plaintext** storage
  (see "Token storage" above).
- The Gradle **wrapper jar** (binary) is not committed; Android Studio generates
  it on first sync, or run `gradle wrapper` once (scripts + properties are
  committed).

### Handoff notes for Phase 7 (offline cache & smart sync)

- Add a **device-authenticated download endpoint** so the player can fetch files
  with its device token and cache them locally beyond the signed-URL lifetime
  (today's `signedUrl`s expire ≈1h).
- Persist the **last good manifest + cached assets** keyed by `checksum`; play
  from cache when offline. The manifest already carries `checksum` +
  `fileSizeBytes` for integrity + cache sizing.
- Smart sync: diff the new manifest against the cache and download only deltas.
- Keep the `DeviceStore`/`PairingRepository` seams; introduce a `MediaCache`
  alongside `ApiClient`.

---

## Planned capability set (by phase)

Capabilities are delivered incrementally. The phase column indicates when each
becomes available; consult [roadmap.md](./roadmap.md) for the authoritative
schedule. Whether a capability actually works on a given device depends on the
hardware/OEM — see [device-limitations.md](./device-limitations.md).

| Capability                  | Description                                                                                         | Phase |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ----- |
| Pairing                     | Display a pairing code and link the device to a screen profile.                                     | 6 ✓   |
| Playback                    | Play image/video/PDF/URL/text manifest items via Media3 ExoPlayer + Compose.                        | 6 ✓   |
| Config & manifest sync      | Resolve the playback manifest by device token; refresh on a cadence.                                | 6 ✓   |
| Offline cache & smart sync  | Cache assets locally (entitled download endpoint); pre-download ~1h; offline playback.              | 7 ✓   |
| Heartbeat                   | Periodically report online status, current item, and health to the backend.                         | 8 ✓   |
| Screenshots                 | Best-effort capture (PixelCopy of the app's own window) + upload.                                   | 8 ✓   |
| Monitoring telemetry        | Report device metrics (storage, app version, playback state, capabilities).                         | 8 ✓   |
| Remote commands             | React to dashboard actions: sync, refresh, restart, clear cache, screenshot, reboot.                | 8 ✓   |
| Proof of play               | Report actual playback events (start/complete/fail/skip/interrupt); bounded offline buffer + flush. | 9 ✓   |
| Emergency pre-emption       | Detect EMERGENCY manifest, interrupt the running item, play emergency, revert on end.               | 9 ✓   |
| Kiosk mode                  | Stay pinned full-screen and block exit to the launcher (device dependent).                          | later |
| Auto-start on boot          | Relaunch automatically after a power cycle (best-effort; see "Auto-start on boot").                 | ✓     |
| In-app APK update           | Self-update to a newer APK pushed/required by the platform.                                         | later |
| Minimum-version enforcement | Refuse to run / force update when below the required minimum version.                               | later |

Kiosk, auto-start, and power control are best-effort and OEM-dependent. The app
must **detect** which of these it can perform and **report** the result to the
dashboard so operators see an accurate picture (see
[device-limitations.md](./device-limitations.md)).

---

## In-app APK update & minimum version (high level)

To keep a fleet of TVs current without physical access, the player supports
self-update, governed centrally by the **Super Admin**:

- The platform tracks a **latest available APK** and a **required minimum
  version** for the player.
- On each heartbeat/launch the app sends its current `versionCode`. The backend
  compares it against the latest and the minimum.
- If a newer build is available the app can **download the signed APK and
  install it** (silently on provisioned/device-owner devices; otherwise it
  prompts the standard installer). The app must hold the "install unknown apps"
  capability or be the device owner for this to work.
- If the running version is **below the required minimum**, the app blocks normal
  operation and forces the update — this lets the Super Admin retire insecure or
  incompatible builds across the fleet.
- Update APKs must be **signed with the same release key** as the installed app,
  or Android refuses the in-place update.

Detailed UX, rollout/targeting rules, and rollback handling are defined when
this ships in Phase 9.

---

## Auto-start on boot (implemented)

The player relaunches itself automatically after the TV or box reboots, so a
dedicated signage screen returns to playback (or the pairing screen) without
anyone opening the app manually.

### How it works

- A manifest-declared `BroadcastReceiver`
  (`com.wizer.signage.system.BootReceiver`) listens for
  `android.intent.action.BOOT_COMPLETED` and, for TV boxes with a vendor
  "fast boot" mode, `android.intent.action.QUICKBOOT_POWERON`.
- On a supported action it starts the existing `MainActivity` with
  `FLAG_ACTIVITY_NEW_TASK`. `MainActivity` is `launchMode="singleTask"`, so an
  already-running player is brought to the front instead of duplicated, and the
  activity itself routes to the **pairing screen** (unpaired) or the **player**
  (paired) exactly as on a manual launch — pairing state, cached media,
  schedules, and offline playback are untouched.
- The launch-decision logic lives in `system/BootLaunch.kt` (pure Kotlin,
  covered by `BootLaunchTest`); the receiver validates the action, ignores
  everything else, never throws out of `onReceive`, and logs nothing sensitive.
- Auto-start is **enabled by default** (dedicated-device use case). It can be
  turned off internally via `DeviceStore.autoStartOnBoot = false` (no settings
  UI exists in the player, so no toggle was added).
- Only `RECEIVE_BOOT_COMPLETED` is required (already declared). No foreground
  service, no `SYSTEM_ALERT_WINDOW`, no accessibility services.
- `LOCKED_BOOT_COMPLETED` (direct boot) is intentionally **not** handled: the
  device token lives in credential-encrypted storage that is unavailable before
  first unlock, and TV signage devices without lock-screen credentials deliver
  `BOOT_COMPLETED` promptly anyway.

### Platform limitations (honest expectations)

- **Fresh install / force-stop:** Android puts an app in the _stopped state_
  after installation and after the user force-stops it. A stopped app receives
  **no broadcasts** — the app must be **opened manually once** before boot
  launches resume. This is platform behaviour; no app can bypass it.
- **Android 10+ background-activity-launch restrictions:** starting an activity
  from the background is blocked in general, but receivers of system broadcasts
  like `BOOT_COMPLETED` are exempt on stock Android/Google TV. Some OEM builds
  (and phone-oriented "battery manager" firmwares on generic boxes) still
  block, delay, or require a per-app "Auto-start" permission — check the OEM
  settings (e.g. _Settings → Apps → Special access → Auto-start_, or vendor
  battery/background restrictions) and exempt the player.
- **Best-effort vs. guaranteed:** on consumer hardware this is _best-effort_.
  **Guaranteed** relaunch on a dedicated device requires provisioning outside
  this app's scope: device-owner (MDM/EMM) with lock-task/kiosk, or setting the
  player as the default HOME/launcher. Those are deliberate non-goals here (see
  [device-limitations.md](./device-limitations.md)).

### Manual verification on a physical Android TV

1. Install the debug APK (`adb install -r app-debug.apk`) or a signed release
   APK on the TV.
2. **Open the app once** (mandatory — clears the stopped state so boot
   broadcasts are delivered).
3. Pair the device with Wizer Signage (pairing code → claim in the dashboard).
4. Confirm content playback (schedule or fallback content plays).
5. Reboot the TV normally (power menu → Restart, or `adb reboot`).
6. After the TV finishes booting, confirm the player comes back to the
   foreground by itself (allow up to ~30–60 s on slower boxes; some launchers
   show their home screen briefly first).
7. Confirm the device is still paired and cached content still plays — pairing
   and cache live in app storage and survive reboots.
8. Disconnect networking (unplug Ethernet / disable Wi-Fi), reboot again, and
   verify the player auto-starts **offline** and plays the cached manifest
   (URL items are skipped offline; that is the existing Phase 7 behaviour).
9. **ADB receiver test** (works on most devices; some OEM shells restrict
   sending protected actions):

   ```bash
   # Watch the receiver's log while testing:
   adb logcat -s BootReceiver
   # Simulated quick-boot broadcast (not protected, deliverable via adb):
   adb shell am broadcast -a android.intent.action.QUICKBOOT_POWERON \
     -p com.wizer.signage
   # The real thing (protected; only a real reboot delivers it system-wide):
   adb reboot
   ```

10. Force-stop test: _Settings → Apps → Wizer Signage → Force stop_, then
    reboot — the player will **not** auto-start (expected: stopped state).
    Open the app once manually and reboot again — auto-start works again.
11. On OEM/generic boxes, if step 6 fails: look for vendor **Auto-start** /
    **background start** / battery-optimization settings and allow the player,
    then retest. If the OS still blocks it, that model needs device-owner /
    MDM / default-launcher provisioning for guaranteed relaunch.

---

## Production handoff (Phase 11)

The Android player is **not modified** in Phase 11 — these are deployment notes.

### Point the player at your production API

`BuildConfig.API_BASE_URL` is set at **build time** (it is not configurable at
runtime). For production, build with your public API origin:

```kotlin
// apps/android-tv-player/app/build.gradle.kts (release buildType)
buildConfigField("String", "API_BASE_URL", "\"https://wizer.sa/api\"")
```

Or override per build via a Gradle property and read it in the build script.
The URL **must** be `https://$APP_DOMAIN/api` (matching `NEXT_PUBLIC_API_URL`),
reachable from the TV's network, with a valid TLS certificate.

### Build, sign & install a release APK

1. **Toolchain (required):** **JDK 17** + the **Android SDK** + a generated
   `gradle-wrapper.jar` (Android Studio sync or `gradle wrapper`). _This cannot
   be built in the CI sandbox used for this repo (JDK 8 / no SDK) — build on a
   real machine or Android Studio._
2. **Release keystore:** generate once and keep it **out of source control**;
   supply it via Gradle properties (`MS_KEYSTORE`, `MS_KEY_ALIAS`, passwords as
   env/`~/.gradle/gradle.properties`). Never commit the keystore or passwords.
   ```bash
   keytool -genkeypair -v -keystore wizer-signage-release.jks \
     -alias wizer-signage -keyalg RSA -keysize 2048 -validity 10000
   ```
3. **Build:** `./gradlew :app:assembleRelease` → a **signed**
   `app-release.apk` (unsigned builds land as `app-release-unsigned.apk` — sign
   before distribution).
4. **Install on Android TV:** enable Developer options + USB/network debugging,
   then `adb connect <tv-ip>` and `adb install -r app-release.apk` (or sideload
   via a USB drive / an MDM). See _Sideloading_ above.
5. **Pair:** launch the app → it shows a pairing code → claim it to a screen in
   the dashboard (see [pairing-guide.md](./pairing-guide.md)).

### Known limitations (unchanged — by design)

- **Build requires JDK 17 + Android SDK** (not buildable in this repo's sandbox).
- **URL content is not reliably cached** → skipped when offline (Phase 7).
- **Screenshots** capture the app's own window only (video on a secure surface
  may be black; API < 26 unsupported) — never fabricated (Phase 8).
- **No kiosk mode, no in-app APK auto-update** — intentionally out of scope;
  pin the app via the launcher / an MDM if needed. **Auto-start on boot IS
  implemented** (best-effort, see "Auto-start on boot"); guaranteed relaunch
  still requires device-owner / MDM / default-launcher provisioning.
- **No payment / WhatsApp / external API portal** in the platform.

---

## Related documentation

- [pairing-guide.md](./pairing-guide.md) — link a device to a screen profile.
- [device-limitations.md](./device-limitations.md) — hardware caveats and the
  capability matrix.
- [roadmap.md](./roadmap.md) — phase-by-phase delivery plan.
- [architecture.md](./architecture.md) — how the player fits the overall system.
