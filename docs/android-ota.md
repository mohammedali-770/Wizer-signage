# Android OTA update channel

Wizer's Android OTA path is intentionally split into **artifact availability**, **rollout authorization**, and **installation**. No one layer can update the fleet by itself.

## 1. Immutable signed release channel

`scripts/publish-android-release.sh` is the source of immutable APK artifacts and the atomic `android/latest.json` pointer. The API exposes only the canonical files emitted by that publisher under `/api/downloads/android/`; arbitrary files in the downloads mount remain private.

The player treats public release metadata as untrusted input. Before downloading it checks:

- schema version;
- package `com.wizer.signage`;
- forward-only `versionCode`;
- device `minSdk` compatibility;
- canonical immutable filename and same-origin download path;
- SHA-256 and signing-certificate fingerprint syntax.

The APK is streamed to a `.part` file and becomes the staged APK only when its final size and SHA-256 exactly match `latest.json`.

## 2. Authenticated staged-rollout authorization

A newer public `latest.json` **does not authorize installation**. A paired screen must separately receive an eligible response from authenticated `GET /api/device/update/policy`.

Company administrators replace the policy with `PUT /api/company-settings/android-ota` (the normal `/api` prefix applies):

```json
{
  "enabled": true,
  "targetVersionCode": 42,
  "rolloutPercent": 5,
  "screenIds": [],
  "groupIds": [],
  "checkIntervalSeconds": 21600
}
```

Rules:

- `enabled=false` immediately halts **new** install attempts.
- `targetVersionCode` is mandatory while enabled and must exactly equal the public release manifest before the client proceeds. Publishing version 43 therefore cannot accidentally advance a policy pinned to 42.
- `screenIds` and `groupIds` are ownership-validated same-company canaries and are eligible regardless of percentage.
- `rolloutPercent` uses a stable SHA-256 cohort of `companyId:screenId`; a screen does not jump cohorts between polls/restarts.
- the polling interval is bounded to 15 minutes–24 hours; default is 6 hours.
- every policy change is written to the company activity log with target, percentage, canary counts and cadence.

Suggested rollout: explicit lab/canary screens → 1% → 5% → 25% → 50% → 100%, with a soak period and fleet health review between stages. The percentages are operational guidance, not automatic timers: promotion is always an explicit admin action.

## 3. APK trust boundary

Before `PackageInstaller` receives the staged APK, `ApkTrustVerifier` checks:

1. the APK is parseable;
2. its package is the currently-running Wizer package;
3. its current signer equals the certificate fingerprint in the already-verified release metadata;
4. the staged APK and installed Wizer app share signing lineage.

Android then performs its own package/signature checks again during installation. A mismatch is reported `BLOCKED` and the staged file is discarded.

## 4. Unattended self-update without kiosk UI

Wizer uses Android's self-update `PackageInstaller` path only on Android 12 (API 31) and newer. The app declares `REQUEST_INSTALL_PACKAGES` and `UPDATE_PACKAGES_WITHOUT_USER_ACTION`, requests `USER_ACTION_NOT_REQUIRED`, and updates its own package.

Device provisioning must allow Wizer to request package installs (`PackageManager.canRequestPackageInstalls() == true`). Wizer deliberately does **not** open the unknown-sources settings page itself. If a TV was not provisioned, it reports `BLOCKED: package_install_permission_not_provisioned` and continues signage playback.

Android may still return `STATUS_PENDING_USER_ACTION` because of device policy, platform/OEM behavior, target-SDK requirements, or future Android changes. Wizer **never launches** that confirmation intent over signage. It records `BLOCKED: platform_requires_user_action` and keeps the existing version running.

Android's target-SDK threshold for unattended updates advances across platform releases. A release process must therefore keep the player target SDK current; the fail-closed pending-user-action result remains mandatory even when the current target satisfies today's rule.

## 5. Install state and fleet telemetry

`AndroidUpdateStateStore` persists the target/version attempt across the package replacement. The client reports to authenticated `POST /api/device/update/result`:

- `DOWNLOADED` — verified APK staged;
- `INSTALLING` — PackageInstaller session committed;
- `INSTALLED` — after restart, `BuildConfig.VERSION_CODE` is at least the pending target;
- `BLOCKED` — trust/provisioning/platform requires action;
- `FAILED` — download/install error or a 30-minute unresolved install timeout.

The server stores the latest OTA state under `Screen.capabilities.androidOta`, alongside timestamp, target, installed version and bounded error text. This gives the dashboard/API a fleet-level view without creating high-volume telemetry rows.

## 6. Halt and rollback

**Halt:** set `enabled=false`. In-progress PackageInstaller sessions cannot be remotely uncommitted by changing server policy, but no new screens will start an install after their next policy fetch.

**Rollback is forward-only.** Android application updates normally reject a lower `versionCode`. If release 42 is unhealthy, rebuild the known-good code as release 43 (or higher), sign with the same Wizer lineage, publish it, canary it, then pin `targetVersionCode=43`. Never repoint `latest.json` at an older APK or weaken the monotonic publisher guard.

## 7. Production release checklist

1. Build/sign with the production Wizer keystore and verify the signing fingerprint.
2. Publish the immutable release; confirm `latest.json`, APK, checksum and per-version manifest are reachable.
3. Leave company rollout policies disabled while validating a lab TV.
4. Ensure lab/canary devices are Android 12+ and Wizer is allowed to request package installs.
5. Pin the exact new `targetVersionCode` with explicit canary screens/groups and `rolloutPercent=0`.
6. Confirm `INSTALLED` telemetry and normal heartbeats/playback after restart.
7. Increase percentage deliberately while watching crash/offline/warning rates.
8. Halt immediately on abnormal health; remediate with a higher-version forward rollback build if necessary.
