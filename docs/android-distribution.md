# Android TV Player — Direct APK Distribution

How a **signed** Wizer Signage player APK (`com.wizer.signage`) is published for
**direct download** and installed on Android TV devices, without Google Play.

This builds on:

- [android-signing.md](./android-signing.md) — how the signed APK + its
  certificate fingerprint are produced (`scripts/build-android-release.sh`).
- [android-player.md](./android-player.md) — the player itself, auto-start, and
  the physical-TV update test.

Distribution is **file-based and immutable**: each release gets a permanent
versioned URL; a small `latest.json` manifest advertises the current version.

---

## 1. Public URL structure

Served by **nginx** directly (read-only) under the existing `/api/downloads/`
prefix — the `android/` subtree is static, everything else under `/api/` still
proxies to the API:

| URL                                                                                            | What                                                                              |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `https://<domain>/api/downloads/android/latest.json`                                           | Machine-readable latest-version manifest (revalidated, `Cache-Control: no-cache`) |
| `https://<domain>/api/downloads/android/wizer-signage-v<versionName>-<versionCode>.apk`        | Immutable signed APK (`Cache-Control: immutable`)                                 |
| `https://<domain>/api/downloads/android/wizer-signage-v<versionName>-<versionCode>.apk.sha256` | Immutable checksum for that APK                                                   |
| `https://<domain>/api/downloads/android/wizer-signage-v<versionName>-<versionCode>.json`       | Immutable per-version manifest                                                    |

Versioned URLs **never change or get overwritten**. Only `latest.json` moves
forward, and only after a new version's APK + checksum + manifest are fully in
place. There is intentionally **no** mutable `latest.apk` — clients read
`latest.json` and fetch the versioned URL.

> The legacy single-file route `https://<domain>/api/downloads/<name>.apk`
> (served by the API container) is unchanged and still works for ad-hoc APKs.

### The APK is public, not a secret

`/api/downloads/` is intentionally public — the same as any app's download page.
The APK is **not treated as a secret**. Authenticity and integrity come from,
in layers:

1. **Android signing** — the APK is signed with the Wizer production key; a
   device only accepts an update whose signature matches the installed app.
2. **Expected certificate fingerprint** — publication refuses any APK whose
   signing certificate does not match `WIZER_ANDROID_EXPECTED_CERT_SHA256`.
3. **Published SHA-256** — the `.sha256` and `latest.json.sha256` let anyone
   verify the exact bytes.
4. **HTTPS/TLS** — transport integrity + authenticity of the origin.

No authentication is added to the download route (the product does not require
it for public downloads). Nothing sensitive lives under `android/`.

---

## 2. Publishing a release

> **Deploying to a remote production VPS? Use the two-stage flow in §5**
> (`scripts/deploy-android-release.sh`) — it does everything below on your
> trusted machine and then transfers + publishes over SSH, so the VPS needs no
> Android SDK. The script below is the underlying primitive: it verifies and
> publishes into a **local** downloads directory (same-host setups, or producing
> the verified bundle that §5 ships).

`scripts/publish-android-release.sh` takes a **verified signed APK** and
publishes it atomically into a **local** downloads directory (it requires the
Android SDK `apksigner`/`aapt`, so it runs on the trusted build machine, not on
a bare VPS). It **fails closed** — it publishes nothing unless every check passes.

```bash
# The expected production signing-cert fingerprint (PUBLIC info — record it when
# you create the key; see android-signing.md §4). Colons/case are ignored.
export WIZER_ANDROID_EXPECTED_CERT_SHA256="AA:BB:...:FF"

scripts/publish-android-release.sh \
  apps/android-tv-player/release-output/wizer-signage-v0.6.0-1.apk \
  --downloads-dir /opt/wizer-signage/downloads
```

`--downloads-dir` defaults to `<repo>/downloads` (the host side of the compose
bind mount; also overridable with `WIZER_DOWNLOADS_DIR`). The APK subtree is
published under `<downloads>/android/`.

What the script enforces before anything is published:

- The input exists and is a **regular file** (symlinks refused unless
  `--allow-symlink`, which resolves + re-validates).
- `apksigner` verifies the APK and **all of v1 + v2 + v3** schemes are present
  (v1 is required for minSdk 21).
- Package is exactly **`com.wizer.signage`**.
- The signing certificate SHA-256 **matches** `WIZER_ANDROID_EXPECTED_CERT_SHA256`
  (normalized). **Debug-signed** APKs are refused explicitly.
- `versionName`/`versionCode`/`minSdk` have safe shapes; the **canonical
  filename is derived from the verified metadata**, never the source filename,
  so a hostile source name cannot influence output paths.
- The version is **not already published** (no silent overwrite) and its
  `versionCode` is **greater** than the current `latest.json` (no downgrade or
  duplicate).

How it publishes (atomic + crash-safe):

- Everything is staged in a temp dir **outside** the public `android/` folder,
  the checksum + JSON are generated (JSON via `python3`, then re-parsed to
  validate) and the staged APK is re-verified with `apksigner`.
- Files are moved into place with `mv` (atomic rename): APK → `.sha256` →
  per-version `.json`, and **`latest.json` last**. A failure at any point leaves
  `latest.json` (and every existing version) untouched. A publish lock
  (`flock`) serializes concurrent runs.

The script writes **only** to the local downloads directory. It never uploads
anywhere — transfer to the VPS is a separate, explicit step (below).

Required environment variable (names only): **`WIZER_ANDROID_EXPECTED_CERT_SHA256`**
(public, but mandatory). Optional: `WIZER_DOWNLOADS_DIR`.

---

## 3. `latest.json` shape

Verified release info only — no filesystem paths, usernames, server details, or
secrets. `versionCode`, `sizeBytes`, and `minSdk` are JSON numbers;
`publishedAt` is ISO-8601 **UTC**.

```json
{
  "schemaVersion": 1,
  "packageName": "com.wizer.signage",
  "versionName": "0.6.0",
  "versionCode": 1,
  "fileName": "wizer-signage-v0.6.0-1.apk",
  "downloadUrl": "/api/downloads/android/wizer-signage-v0.6.0-1.apk",
  "sha256": "<apk sha-256>",
  "certificateSha256": "<signing cert sha-256>",
  "sizeBytes": 8464,
  "minSdk": 21,
  "publishedAt": "2026-07-16T14:07:44Z"
}
```

`downloadUrl` is always under the immutable `/api/downloads/android/` prefix and
contains no path traversal.

---

## 4. Nginx / container serving

The `location ^~ /api/downloads/android/` block in
`infra/nginx/templates/wizer-signage.conf.template` serves this subtree
statically from a **read-only** mount (`../../downloads:/usr/share/nginx/downloads:ro`
on the nginx service). It:

- allows **GET/HEAD only** (`limit_except` rejects POST/PUT/PATCH/DELETE);
- **disables directory listing** (`autoindex off`);
- sets the correct content types (`.apk` →
  `application/vnd.android.package-archive`, `.json` → `application/json`,
  `.sha256` → `text/plain`) with **`X-Content-Type-Options: nosniff`**;
- caches versioned APK/checksum/manifest files **`immutable`**, and
  `latest.json` **`no-cache`**;
- keeps **HTTP range requests** (resumable large downloads) enabled;
- **denies dotfiles and `*.tmp`/`*.part`/`*.swp`**;
- preserves **HSTS / TLS-only** behavior (HTTP → HTTPS redirect).

The **public serving container never needs write access** — publication writes
the host directory; both nginx and the API mount it read-only.

---

## 5. Operator deployment workflow (two trust stages)

The production VPS **does not need the Android SDK, Gradle, or Java**. All
cryptographic verification happens on the trusted build/operator machine (or CI);
the VPS only receives an already-verified bundle over SSH, re-checks the APK
SHA-256, and publishes atomically with normal host tools.

### Minimum VPS dependencies

A clean Ubuntu VPS (Docker + Compose per [production-deployment.md](./production-deployment.md))
already has everything the remote side needs:

| Purpose                 | Tools (all in the Ubuntu base)                    |
| ----------------------- | ------------------------------------------------- |
| Authenticated transport | `sshd` + `sftp-server` (openssh-server)           |
| Re-verify + publish     | `sha256sum`, `mkdir`, `mv`, `flock`, `find`, `rm` |

**No `apksigner`, `aapt`, Gradle, Java, Python, or Node is required on the VPS.**
The publisher runs as an unprivileged SSH user that can write only the downloads
directory. Signing keys/passwords never leave the trusted machine.

### On the trusted build/operator machine (has the Android SDK)

1. **Build** the signed APK (needs the production key):
   ```bash
   scripts/build-android-release.sh
   # → apps/android-tv-player/release-output/wizer-signage-v<name>-<code>.apk
   ```
2. **Ensure the VPS host key is known** once (keeps host-key verification on):
   ```bash
   ssh-keyscan -H <vps> >> ~/.ssh/known_hosts   # first time only
   ```
3. **Verify + deploy in one step.** `deploy-android-release.sh` runs the FULL
   verification locally (apksigner v1+v2+v3, package, expected-cert fingerprint,
   version, checksum, manifests — via `publish-android-release.sh`), builds a
   verified bundle in a temp dir, then transfers it over SSH and publishes it
   atomically on the VPS:
   ```bash
   export WIZER_ANDROID_EXPECTED_CERT_SHA256="<recorded fingerprint>"   # public; see android-signing.md §4
   scripts/deploy-android-release.sh \
     apps/android-tv-player/release-output/wizer-signage-v<name>-<code>.apk \
     --host deploy@<vps> \
     --remote-downloads /opt/wizer-signage/downloads \
     --identity ~/.ssh/id_ed25519
   ```
   A **wrong signing key, wrong package, or unsigned APK is rejected before any
   transfer.** The VPS re-verifies the APK checksum, refuses
   overwrite/duplicate/downgrade (from the max on-disk versionCode), and moves
   `latest.json` **last**; the remote staging dir is cleaned on success or
   failure, so an interrupted transfer never changes the current release.
   (Use `--dry-run` to verify + build the bundle without connecting, or
   `--bundle <dir>` to deploy a pre-built bundle from CI.)

### Verify the published release over HTTPS

4. **`latest.json`**, **checksum**, and **signature**:
   ```bash
   curl -fsS https://<domain>/api/downloads/android/latest.json
   curl -fsSLO https://<domain>/api/downloads/android/wizer-signage-v<name>-<code>.apk
   curl -fsSLO https://<domain>/api/downloads/android/wizer-signage-v<name>-<code>.apk.sha256
   sha256sum -c wizer-signage-v<name>-<code>.apk.sha256
   apksigner verify --print-certs wizer-signage-v<name>-<code>.apk   # cert must match (on a machine that has the SDK)
   ```
5. **Install on a test TV** (see [android-player.md](./android-player.md) for the
   Downloader/adb flow) and confirm playback + auto-start.
6. **Confirm the update preserves pairing + cache** (same-key update; see the
   physical-TV update test in [android-signing.md](./android-signing.md) §7).
7. **Roll out** to additional TVs manually (Downloader app pointing at the
   versioned URL, adb, or your MDM).

> **Installation still requires confirmation.** On a normal Android TV, sideload
> installs prompt a technician/user to approve "install unknown apps". Silent /
> unattended install requires the device to be **provisioned as a managed
> device** (device-owner/MDM) with install privileges — out of scope here.

---

## 6. Retention & rollback

**Never delete old releases as part of publishing.** They are preserved so that:

- Devices still fetching an older versioned URL keep working.
- You can diagnose or re-point after a bad release.

**List available versions / find the current latest:**

```bash
ls -1 /opt/wizer-signage/downloads/android/*.apk           # all published APKs
curl -fsS https://<domain>/api/downloads/android/latest.json | jq '.versionName, .versionCode'
```

**Recovering from a bad release.** Android will **not** install a _lower_
`versionCode` as an update, and this publisher likewise refuses to publish a
`versionCode` ≤ the current latest (no hidden downgrade/overwrite bypass). So
rollback is a **deliberate forward action**, not a delete:

1. Take the previous **stable source**, bump its `versionCode` **above** the bad
   release (keep/adjust `versionName`, e.g. `0.6.2` re-releasing 0.6.0's code),
   and rebuild + re-sign with the **same production key**
   (`scripts/build-android-release.sh`).
2. Publish it normally — it becomes the new `latest.json` and installs cleanly
   as an update over the bad version.
3. Only the mutable `latest.json` pointer needs to move; every prior versioned
   URL stays intact.

If you must stop advertising a bad release _immediately_ before a fixed build is
ready, the safe administrative action is to **restore `latest.json` to the last
good version's manifest** (kept as `wizer-signage-v<good>.json`) — a single
manual, deliberate step. Do not delete the bad APK out from under devices that
may already be mid-download; prune old versions later, on a schedule, once no
fleet depends on them.

> Deleting old releases immediately is unsafe: in-flight downloads break, rollback
> loses its reference point, and a device pinned to a versioned URL 404s.
