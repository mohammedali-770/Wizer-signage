# Android OTA update channel

Wizer's Android OTA path is intentionally split into **artifact availability**, **rollout authorization**, **installation**, and **health-gated recovery**. No one layer can update the fleet by itself.

## 1. Immutable signed release channel

`scripts/publish-android-release.sh` is the source of immutable APK artifacts and the atomic `android/latest.json` pointer. Every release also has an immutable per-version manifest named `wizer-signage-v<versionName>-<versionCode>.json`. The API/nginx distribution surface exposes only canonical published files under `/api/downloads/android/`.

The player treats public release metadata as untrusted input. Before downloading it checks schema, package, forward-only `versionCode`, device `minSdk`, canonical filename/path, SHA-256, and signing-certificate syntax. The APK is streamed to a `.part` file and becomes staged only when its final size and SHA-256 match the authorized per-version manifest.

`latest.json` is **discovery metadata only**. It is not the rollout coordinate. A newer publish may advance `latest.json` while a canary remains pinned to an earlier candidate.

The API also keeps a read-only release-catalog verifier over the shared immutable downloads mount. A rollout cannot be armed unless the candidate and recovery manifests, APKs, and checksum sidecars are all present and internally consistent.

## 2. Authenticated staged-rollout authorization

A public release **does not authorize installation**. A paired screen must separately receive an eligible response from authenticated `GET /api/device/update/policy`.

Company administrators replace policy with `PUT /api/company-settings/android-ota`:

```json
{
  "enabled": true,
  "targetVersionName": "1.4.2",
  "targetVersionCode": 42,
  "rollbackVersionName": "1.4.1-safe",
  "rollbackVersionCode": 43,
  "rolloutPercent": 5,
  "screenIds": [],
  "groupIds": [],
  "checkIntervalSeconds": 21600,
  "healthWindowSeconds": 900
}
```

Rules:

- `enabled=false` is the emergency halt. It never depends on candidate/recovery files or canary ownership still being valid.
- `targetVersionName` + `targetVersionCode` identify the exact immutable candidate.
- `rollbackVersionName` + `rollbackVersionCode` identify a **pre-published known-good recovery build**. They are mandatory while arming a rollout.
- `rollbackVersionCode` must be strictly greater than the candidate code. Android does not support unattended downgrade; recovery is therefore a forward update containing known-good code.
- candidate and recovery artifacts must both pass the server release-catalog verification before enablement.
- malformed/incomplete stored candidate identity fails closed to devices; Wizer never falls back to `latest.json`.
- `screenIds` and `groupIds` are same-company canaries and are eligible regardless of percentage.
- `rolloutPercent` uses a stable SHA-256 cohort of `companyId:screenId`.
- polling is bounded to 15 minutes–24 hours; default 6 hours.
- the health window is bounded to 5–60 minutes; default 15 minutes.
- every explicit save creates a new `policyRevision` and is activity-logged.

Suggested rollout: explicit lab/canary screens at 0% → 1% → 5% → 25% → 50% → 100%, with fleet-health review between stages.

## 3. Policy-revision attempt isolation

Every Android update result includes the exact `policyRevision` that authorized it. The API persists that revision with `Screen.capabilities.androidOta`.

This prevents an old failed attempt from contaminating a new explicit save of the same candidate. Terminal `BLOCKED`/`FAILED` state is sticky for its original revision; a new operator revision permits one deliberate retry after remediation.

## 4. APK trust boundary

Before `PackageInstaller` receives a staged APK, `ApkTrustVerifier` checks:

1. the APK is parseable;
2. its package is the running Wizer package;
3. its current signer equals the fingerprint in release metadata;
4. staged and installed Wizer apps share signing lineage.

Android performs its own package/signature checks again during installation. A mismatch is `BLOCKED` and the staged file is deleted.

Production release networking is HTTPS-only. LAN/cleartext exceptions exist only in the debug source set. Android app backup and device-transfer backup are disabled so pairing/device credentials cannot be cloned onto another TV.

## 5. Unattended self-update without kiosk UI

Wizer uses the self-update `PackageInstaller` path only on Android 12+ (API 31+). It declares `REQUEST_INSTALL_PACKAGES` and `UPDATE_PACKAGES_WITHOUT_USER_ACTION`, requests `USER_ACTION_NOT_REQUIRED`, and updates its own package.

Provisioning must allow Wizer to request package installs. Wizer deliberately does **not** open unknown-sources Settings or a confirmation intent over signage. If the platform returns `STATUS_PENDING_USER_ACTION`, Wizer records `BLOCKED: platform_requires_user_action` and keeps current playback running.

## 6. Install state and fleet telemetry

`AndroidUpdateStateStore` persists candidate version + policy revision across package replacement. The client reports to authenticated `POST /api/device/update/result`:

- `DOWNLOADED` — verified APK staged;
- `INSTALLING` — PackageInstaller session committed;
- `INSTALLED` — after restart, installed `VERSION_CODE` reached the pending target;
- `BLOCKED` — trust/provisioning/platform requires intervention;
- `FAILED` — download/install error or unresolved install timeout.

The API stores state, authorizing policy revision, target/installed version, bounded error, and `reportedAt` under `Screen.capabilities.androidOta`.

## 7. Healthy-heartbeat automatic recovery

The normal maintenance cycle runs `AndroidOtaHealthService` before slower retention/report work.

For the current candidate **and current policy revision only**, the worker inspects screens that reported `INSTALLING` or `INSTALLED`. Once `healthWindowSeconds` has elapsed, the attempt is proven healthy only when the screen has subsequently sent a heartbeat from the exact candidate `appVersion` and the latest device snapshot has no playback error, failed/partial sync, or `lastSyncError`.

If one or more attempted screens fail that gate:

1. the worker re-verifies the pre-published recovery artifact;
2. it performs a compare-and-swap on the exact policy revision, so a concurrent operator save wins;
3. it atomically changes the target to the higher-version known-good recovery build while preserving the same rollout cohort/canaries;
4. it records `lastAutoRollback` with candidate, recovery, timestamp, and a bounded failed-screen sample;
5. it emits a CRITICAL dashboard/email event `android.ota.auto_rollback`.

If the recovery artifact has disappeared or become invalid, Wizer **halts new installs instead** and leaves a CRITICAL open alert for operator recovery.

A screen that already proved a clean post-install heartbeat is not retroactively failed merely because it later has an unrelated network outage.

After an automatic recovery, the recovery target remains enabled long enough for affected devices to install it, but the recovery coordinate is consumed. Arming a future candidate requires a newly published higher-version known-good recovery coordinate.

## 8. Halt and rollback model

**Halt:** set `enabled=false`. In-progress PackageInstaller sessions cannot be remotely uncommitted, but no new screen starts an install after its next policy fetch. Halt validation is intentionally independent of release-catalog/canary state.

**Recovery is forward-only.** Never repoint `latest.json` to an older APK and never weaken the monotonic publisher guard. Known-good source is rebuilt and signed under a higher `versionCode` before rollout begins, so automatic recovery remains a normal Android update.

## 9. Production release checklist

1. Build/sign candidate with the production Wizer keystore using explicit version name/code and HTTPS API base URL.
2. Publish candidate; verify immutable APK, checksum, per-version manifest, and signing fingerprint.
3. Build/sign the current known-good source under a **higher** versionCode; publish it as the recovery release.
4. Keep rollout disabled while validating both artifacts and a lab TV.
5. Confirm lab/canary devices are Android 12+ and provisioned for package installs.
6. In Company → Settings → Android OTA, enter candidate and recovery name/code, set explicit canaries, `rolloutPercent=0`, and a deliberate health window.
7. Save/enable; confirm policy revision, `INSTALLING`/`INSTALLED`, and a clean post-install heartbeat.
8. Deliberately increase rollout percentage while watching Fleet Health, crash diagnostics, offline alerts, and automatic-recovery notifications.
9. Exercise the health gate in staging/lab at least once and confirm the affected cohort receives the pre-staged recovery build automatically.
10. Keep the emergency Halt control available throughout rollout.
