# Wizer Signage — Android TV Player

Native Android TV (leanback) player for the Wizer Signage digital signage platform.
Built with **Kotlin 2.4.10**, **Jetpack Compose** (Material3) and **Media3 / ExoPlayer**.

This is the **Phase 6 player foundation**: device-initiated pairing, a device-token
manifest client, and a full-screen Compose/Media3 player for image / video / PDF (first
page) / URL / text content. Offline caching, heartbeat, screenshots, kiosk, and auto-start
arrive in later phases. See [`docs/android-player.md`](../../docs/android-player.md) §
"Phase 6 — Player foundation" for the architecture, pairing flow, device-token security,
and known limitations.

The API base URL is `BuildConfig.API_BASE_URL` in `app/build.gradle.kts`. It **defaults to
production** (`https://signage.wizer.sa/api` — the host nginx actually serves) so no build
ships the emulator URL by accident. For local emulator development, override it at build
time:

```bash
./gradlew assembleDebug -PapiBaseUrl=http://10.0.2.2:3001/api
```

There is **no OTA update channel**: an APK baked against the wrong host can never pair or
sync and has to be re-flashed screen by screen. `scripts/build-android-release.sh`
therefore refuses to build unless the host is stated explicitly:

```bash
scripts/build-android-release.sh --api-base-url=https://signage.wizer.sa/api
```

| | |
|---|---|
| Application ID | `com.mastersignage.player` |
| Version | `0.6.0` (versionCode 1) |
| Min SDK | 21 |
| Target / Compile SDK | 34 |
| Gradle | 8.7 |
| AGP | 8.5.x |
| Kotlin | 2.4.10 (Compose Compiler Gradle plugin, versioned with Kotlin) |
| Form factor | Android TV (leanback launcher) |

## Prerequisites

- **Android Studio** (Koala / 2024.1+ recommended).
- **JDK 17** (AGP 8.5 requires Java 17 — Android Studio bundles a suitable JBR).
- An Android TV emulator image or a physical Android TV device (minSdk 21).

## Open and run

1. Open **only** the `apps/android-tv-player` folder in Android Studio (it is a standalone
   Gradle project, not part of the pnpm/Turborepo JS workspace).
2. Let Android Studio sync Gradle and download dependencies.
3. Select the `app` run configuration and deploy to an Android TV emulator/device.

### Gradle wrapper

The complete Gradle wrapper is **committed** — `gradle/wrapper/gradle-wrapper.jar` (Gradle
8.7, SHA-256 `cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8`, matching
the official 8.7 wrapper jar), `gradle/wrapper/gradle-wrapper.properties`, and the
`gradlew`/`gradlew.bat` scripts. A fresh clone can run `./gradlew` immediately:

```bash
# from apps/android-tv-player
./gradlew clean assembleDebug
```

### Launcher icon

The launcher icon (`@mipmap/ic_launcher`, also used as the TV `android:banner`) is an
all-vector adaptive icon: `mipmap-anydpi-v26/ic_launcher.xml` (API 26+) backed by
`drawable/ic_launcher_{background,foreground}.xml`, with `mipmap/ic_launcher.xml` as the
API 21–25 fallback. **Known limitation:** a vector in the unqualified `mipmap/` folder is
not reliably rendered as a launcher icon by some pre-API-26 launchers (it may show blank on
API 21–25 — build still succeeds and the app runs). Real Android TV targets are API 26+,
where the adaptive icon renders correctly. Add density-qualified PNG fallbacks
(`mipmap-*dpi/ic_launcher.png`) if you must support API 21–25 launchers.

## Project layout

```
android-tv-player/
├─ settings.gradle.kts          # repositories + module includes (version catalogs enabled)
├─ build.gradle.kts             # root plugins (apply false)
├─ gradle.properties            # AndroidX, Kotlin code style, JVM args
├─ gradle/
│  ├─ libs.versions.toml        # version catalog (single source of dependency versions)
│  └─ wrapper/                  # gradle-wrapper.properties (jar generated locally)
└─ app/
   ├─ build.gradle.kts          # app module (compose + media3 + leanback)
   ├─ proguard-rules.pro        # R8 rules placeholder (minify off in Phase 0)
   └─ src/main/
      ├─ AndroidManifest.xml    # permissions, leanback feature, MainActivity intents
      ├─ java/com/mastersignage/player/
      │  ├─ MainActivity.kt      # immersive full-screen splash + placeholder pairing code
      │  └─ ui/theme/            # Material3 dark theme (Color/Type/Theme)
      └─ res/
         ├─ values/             # strings, colors, base window theme
         └─ xml/                # network_security_config (cleartext for local dev only)
```

## Notes & later phases

- **Dependency versions** are centralized in `gradle/libs.versions.toml`. From Kotlin 2.0
  the Compose Compiler ships as the `org.jetbrains.kotlin.plugin.compose` Gradle plugin and
  is versioned in lockstep with Kotlin, so there is no separate compiler-extension version
  to keep in sync; `composeOptions.kotlinCompilerExtensionVersion` is gone.
- **Launcher icons / TV banner**: adaptive `mipmap` icons and the TV banner asset are added
  in a later phase. The manifest currently references `@mipmap/ic_launcher`.
- **Boot auto-start**: a commented `BootReceiver` placeholder exists in the manifest
  (`RECEIVE_BOOT_COMPLETED`) — wired up in **Phase 6/8** with kiosk mode.
- **Cleartext networking** is allowed only for local dev hosts via
  `res/xml/network_security_config.xml`; production traffic (API + Supabase) is HTTPS.
- **Pairing, offline cache, kiosk, and auto-start** are **not** part of Phase 0.

## Related documentation

- [`docs/android-player.md`](../../docs/android-player.md) — player architecture & lifecycle
- [`docs/pairing-guide.md`](../../docs/pairing-guide.md) — device pairing flow
- [`docs/device-limitations.md`](../../docs/device-limitations.md) — TV/hardware constraints
