# Android TV Player — Release Signing

How Wizer Signage produces a **signed, distributable** release APK for the
native Android TV player (`com.wizer.signage`), how the owner creates and
protects the production signing key, and how to validate updates on a real TV.

This covers **direct APK distribution** (sideload / MDM), which is how the
signage player is delivered — it is **not** assumed to go through Google Play.

> Related: [android-player.md](./android-player.md) (build/install),
> [pairing-guide.md](./pairing-guide.md), [device-limitations.md](./device-limitations.md).

---

## 1. How signing is wired up

Release signing credentials come **only from environment variables** — never
from tracked files, `gradle.properties`, hardcoded values, or the command line:

| Variable                          | Meaning                                              |
| --------------------------------- | ---------------------------------------------------- |
| `WIZER_ANDROID_KEYSTORE_PATH`     | Path to the production keystore (`.jks`/`.keystore`) |
| `WIZER_ANDROID_KEYSTORE_PASSWORD` | Keystore (store) password                            |
| `WIZER_ANDROID_KEY_ALIAS`         | Key alias inside the keystore                        |
| `WIZER_ANDROID_KEY_PASSWORD`      | Password for that key                                |

`apps/android-tv-player/app/build.gradle.kts` reads these with `System.getenv`
and behaves as follows:

- **None of the four set** → no release `signingConfig` is created;
  `assembleRelease` produces an **unsigned**, **non-distributable**
  `app-release-unsigned.apk`. This keeps debug builds, unit tests, and dev/CI
  flows working with no production secret present.
- **Some but not all set** → the Gradle configuration **fails immediately**,
  listing only the **missing variable names** (never any value).
- **All four set** → the keystore is validated (exists + readable) and the
  release build is **signed** with the **v1 + v2 + v3** schemes.

Nothing prints a password: the build reads them from the environment, and the
release script passes the keystore password to `apksigner` via an env-var
reference (`pass:env:...`), never as a literal argument.

The debug build type is untouched — debug APKs keep using the auto-generated
debug keystore.

---

## 2. Building a signed release (the only supported path)

Use the dedicated script — it **fails closed**: it never reports success for an
unsigned APK and aborts on any missing credential, test, lint, build, signing,
package, or checksum failure.

```bash
# 1. Provide the four credentials via the environment (see §4 for creating them).
#    Prefer a secrets manager / prompt over shell history. For example, read the
#    passwords without echoing them:
export WIZER_ANDROID_KEYSTORE_PATH="/secure/wizer-signage-release.jks"
export WIZER_ANDROID_KEY_ALIAS="wizer-signage"
read -rs -p "Keystore password: " WIZER_ANDROID_KEYSTORE_PASSWORD; echo; export WIZER_ANDROID_KEYSTORE_PASSWORD
read -rs -p "Key password: "      WIZER_ANDROID_KEY_PASSWORD;      echo; export WIZER_ANDROID_KEY_PASSWORD

# 2. Build + verify.
scripts/build-android-release.sh
```

The script:

1. Validates all four env vars (fail closed; lists only missing **names**).
2. Validates the keystore exists and is readable.
3. Runs unit tests (`:app:testDebugUnitTest`).
4. Runs Android lint (`:app:lintRelease`).
5. Builds `:app:assembleRelease` (signed, because the env vars are present).
6. Locates `app/build/outputs/apk/release/app-release.apk` deterministically.
7. Verifies the signature with **`apksigner verify --verbose --print-certs`**.
8. Prints only safe info: certificate **SHA-256 fingerprint**, certificate
   subject (DN), package name, `versionName`, `versionCode`, and which
   signature schemes are present.
9. Confirms the package is exactly **`com.wizer.signage`**.
10. Writes a **SHA-256 checksum** file and re-verifies it.
11. Copies the verified APK into the **gitignored**
    `apps/android-tv-player/release-output/` directory.
12. Names the artifacts:
    - `wizer-signage-v<versionName>-<versionCode>.apk`
    - `wizer-signage-v<versionName>-<versionCode>.apk.sha256`

It **refuses to overwrite** an existing release artifact — bump `versionCode`
(and usually `versionName`) for each build.

Requirements: **JDK 17**, the **Android SDK** (`ANDROID_HOME`/`ANDROID_SDK_ROOT`)
with build-tools (`apksigner`, `aapt`), and either the Gradle wrapper jar or a
system `gradle` on `PATH`.

### Signature schemes (minSdk 21)

The signing config enables **v1 (JAR)**, **v2**, and **v3**:

- **v1** is required for **Android 5.0–6.0 (API 21–23)**.
- **v2** (API 24+) and **v3** (API 28+, adds key-rotation support) are
  backward-compatible — older devices simply fall back to v1.

Gradle signs and zip-aligns in the correct order (align, then sign). **Do not**
manually re-sign an APK that Gradle already signed correctly — `apksigner
verify` in the script confirms the schemes are present and valid.

---

## 3. Version bumps for updates

Each distributed update must increase **`versionCode`** (Android compares the
integer to allow an update) in `apps/android-tv-player/app/build.gradle.kts`;
`versionName` (e.g. `0.6.0` → `0.6.1`) is the human-facing string. The release
script reads both from the built APK, so the artifact name always matches.

---

## 4. Creating the production signing key (owner action)

> **The real production keystore is NOT generated by this repo or any script.**
> Mohammed (the Wizer owner/administrator) creates it **once**, locally, and
> keeps it out of Git forever.

Generate it with `keytool` (ships with the JDK). **Do not put passwords on the
command line** — omit `-storepass`/`-keypass` so `keytool` prompts securely:

```bash
keytool -genkeypair -v \
  -keystore wizer-signage-release.jks \
  -storetype PKCS12 \
  -alias wizer-signage \
  -keyalg RSA -keysize 4096 -sigalg SHA256withRSA \
  -validity 10000
# keytool then prompts (hidden input) for the keystore password, key details
# (CN/O/OU/L/ST/C), and confirmation. Use a distinct strong password per prompt.
```

- **PKCS12** keystore (modern default), **RSA 4096**, **SHA256withRSA**.
- **`-validity 10000`** ≈ 27 years — a signing certificate for a directly
  distributed app must outlive every future update (an expired cert blocks
  updates on older installs).
- **`-alias wizer-signage`** — an organization-controlled alias (record it).
- Passwords are entered **interactively**, never embedded or committed.

Immediately after creation, record the certificate **SHA-256 fingerprint**
(store it separately from the keystore — see §5):

```bash
keytool -list -v -keystore wizer-signage-release.jks -alias wizer-signage
#   → look for "SHA256:" under "Certificate fingerprints".
# (apksigner also prints it for any signed APK: apksigner verify --print-certs app.apk)
```

---

## 5. Protecting the key — mandatory rules

This is the **application signing key for direct APK distribution**. Treat it as
a top-tier secret.

- **Every future TV update MUST be signed with this same key.** Android only
  accepts an update whose signature matches the installed app.
- **Losing the key** makes it impossible to update existing installations
  normally — users would have to **uninstall** (losing pairing, cache, and
  local state) and reinstall a differently-signed build.
- **Changing the key** causes Android to **reject the update**
  (`INSTALL_FAILED_UPDATE_INCOMPATIBLE` / signature mismatch).
- **Never** send the keystore or its passwords through **chat, email, Git,
  tickets, or any shared drive**. They must never enter this repository.
- Keep **at least two encrypted, offline backups** of the keystore in separate
  physical locations (e.g. two encrypted USB drives / an encrypted vault).
- Store the **passwords** in an **organization-controlled password manager**
  (not personal, not alongside the keystore).
- Record the certificate **SHA-256 fingerprint** in a separate key registry so
  any future build can be verified against the expected identity.
- **Limit access** to authorized Wizer administrators only.
- **Key rotation** for directly distributed APKs is constrained: v3 supports a
  rotation _lineage_, but old devices / some installers still require the
  original key, so rotation is not a simple swap. Plan around **keeping the
  original key safe** rather than rotating it.

---

## 6. Key types — do not confuse them

Because this player is **directly distributed** (sideload / MDM), only the first
one applies today. The others exist only if you later publish through Google
Play — a decision Wizer has **not** made for the TV player.

| Key                                             | What it is                                                                                                                                        | Who holds it                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Direct-distribution application signing key** | The key that signs the APK end users install directly. This is the key created in §4. Every update must use it.                                   | **Wizer** (this is the one that matters here) |
| **Google Play app-signing key**                 | If you enroll in Play App Signing, Google holds and re-signs your app with this key for Play delivery. Irrelevant for direct distribution.        | Google (Play only)                            |
| **Google Play upload key**                      | A separate key you use only to upload to the Play Console; Google verifies it, then re-signs with the app-signing key. Not used for sideload/MDM. | Wizer, Play uploads only                      |

For Wizer Signage's Android TV player, the **direct-distribution application
signing key (§4)** is the single key to create, protect, and reuse.

---

## 7. Physical Android TV update test

Validate signed updates on a real device (this cannot be fully verified in a
build sandbox). Do **not** commit any temporary `versionCode` bump used here.

1. **Initial install.** Build with the production key (`scripts/build-android-release.sh`)
   and install on the TV:
   ```bash
   adb install -r apps/android-tv-player/release-output/wizer-signage-v0.6.0-1.apk
   ```
2. **Open once, pair, cache.** Launch the app, pair it to a screen, let it cache
   content (so there is real local state to preserve).
3. **Bump `versionCode`** in `app/build.gradle.kts` (e.g. `1` → `2`; usually
   also `versionName`) for a test update. _Do not commit this bump._
4. **Build the update with the SAME key** (same four env vars) →
   `wizer-signage-v0.6.1-2.apk`.
5. **Install as an update:**
   ```bash
   adb install -r apps/android-tv-player/release-output/wizer-signage-v0.6.1-2.apk
   ```
6. **Confirm Android accepts it** (no uninstall, `Success`).
7. **Confirm state is intact:** still paired, cached content present, schedules
   and settings unchanged (pairing/cache/settings live in app storage and
   survive same-key updates).
8. **Confirm playback + auto-start** still work (reboot the TV; the player
   returns — see the auto-start section of [android-player.md](./android-player.md)).
9. **Negative test — different key.** Build an APK signed with a **different,
   disposable** keystore (same `versionCode`), then try:
   ```bash
   adb install -r /path/to/differently-signed.apk
   ```
10. **Confirm Android REJECTS it** with a signature-mismatch error
    (`INSTALL_FAILED_UPDATE_INCOMPATIBLE` / `signatures do not match`). This
    proves only the genuine production key can update installed devices.

---

## 8. What is never committed

`.gitignore` (root + `apps/android-tv-player/`) excludes keystores (`*.jks`,
`*.keystore`, `keystore.properties`), all APKs/AABs (`*.apk`, `*.aab`),
`local.properties`, and the `release-output/` directory. No signing secret, no
keystore, and no built APK is ever tracked by Git.
