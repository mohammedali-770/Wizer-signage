# MasterSignage — Android TV Player

Native Android TV (leanback) player for the MasterSignage digital signage platform.
Built with **Kotlin 1.9.24**, **Jetpack Compose** (Material3) and **Media3 / ExoPlayer**.

This is the **Phase 6 player foundation**: device-initiated pairing, a device-token
manifest client, and a full-screen Compose/Media3 player for image / video / PDF (first
page) / URL / text content. Offline caching, heartbeat, screenshots, kiosk, and auto-start
arrive in later phases. See [`docs/android-player.md`](../../docs/android-player.md) §
"Phase 6 — Player foundation" for the architecture, pairing flow, device-token security,
and known limitations.

The API base URL is `BuildConfig.API_BASE_URL` in `app/build.gradle.kts` (defaults to the
emulator host `http://10.0.2.2:3001/api`).

| | |
|---|---|
| Application ID | `com.mastersignage.player` |
| Version | `0.6.0` (versionCode 1) |
| Min SDK | 21 |
| Target / Compile SDK | 34 |
| Gradle | 8.7 |
| AGP | 8.5.x |
| Kotlin | 1.9.24 (Compose Compiler ext `1.5.14`) |
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

### Generate the Gradle wrapper jar

The Gradle wrapper **jar is intentionally not committed**. After cloning, generate the
wrapper (jar + `gradlew`/`gradlew.bat` scripts) once using a locally installed Gradle that
matches the pinned distribution:

```bash
# from apps/android-tv-player
gradle wrapper --gradle-version 8.7
```

The pinned distribution URL already lives in `gradle/wrapper/gradle-wrapper.properties`.
After this, use `./gradlew` (or `gradlew.bat` on Windows) for all builds. Android Studio
also offers to set up the wrapper automatically on first sync.

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

- **Dependency versions** are centralized in `gradle/libs.versions.toml`. We do **not** use
  the Compose Compiler Gradle plugin (that is Kotlin 2.0+); with Kotlin 1.9 we rely on
  `buildFeatures.compose` + `composeOptions.kotlinCompilerExtensionVersion = "1.5.14"`.
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
