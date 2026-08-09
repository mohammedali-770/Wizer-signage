# Wizer Signage production cutover

This is the operator sequence for the first real Wizer Signage production release. It is deliberately ordered so irreversible/mutating steps occur only after the preceding safety gate passes.

## 1. Freeze the release coordinate

- Merge only a protected, green `main` commit.
- Record the full 40-character Git SHA. Production is deployed by immutable SHA, never by a moving branch name.
- Publish API/dashboard/maintenance images from that exact revision to GHCR.
- Do not promote or rebuild an image under the same SHA tag.

## 2. Prepare the production host

Configure the production `.env` with real production values, including:

- `APP_DOMAIN`
- `DATABASE_URL` / `DIRECT_URL`
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
- `ENCRYPTION_KEY`
- `IMAGE_REGISTRY_PREFIX=ghcr.io/<owner>`
- `METRICS_TOKEN` (32+ characters)

Authenticate Docker to GHCR with a **read-only** package credential. Do not place registry write credentials on the application host.

Run:

```bash
scripts/production-preflight.sh <FULL_GIT_SHA>
```

The preflight is read-only. It must pass before continuing. It verifies required host tools, Compose rendering, production-like endpoints, secret-length floors, registry shape, database URL shape, free disk, open-file headroom, and immutable SHA format without printing secret values.

## 3. Backup and migration safety

The blue/green deploy path takes the mandatory database backup before migrations. The migration must satisfy the repository's expand/backfill/contract compatibility guard; a deployment that requires immediately dropping/renaming live application columns is not a zero-downtime deployment.

For the telemetry-partition migration, perform the first conversion during the agreed pre-production/maintenance window because it intentionally takes an exclusive table lock while it copy/swaps existing telemetry into partitioned parents. Validate the resulting parent/child/trigger/session-registry catalog before proceeding.

## 4. Deploy through the mandatory wrapper

Use:

```bash
scripts/deploy-production.sh <release arguments accepted by deploy-blue-green.sh>
```

Do not call `deploy-blue-green.sh` directly during normal operations. The wrapper runs the mandatory production preflight first.

Expected sequence:

1. Verify/pull the immutable release images.
2. Take the pre-migration database backup.
3. Apply compatible forward migrations.
4. Start the inactive API/dashboard slot.
5. Wait for container health/readiness.
6. Atomically switch the persistent Nginx upstream file and gracefully reload Nginx.
7. Run public readiness and smoke tests.
8. If either post-switch gate fails, restore the previous upstream automatically.
9. Drain the old API. Keep the previous dashboard temporarily available as fallback for old hashed `/_next/static` assets.
10. Append successful deployment history only after the public gate succeeds.

## 5. Observe the release

Immediately check:

- `/api/health/ready` externally;
- Monitoring dashboard online/offline/warning counts;
- failed-sync count;
- player version distribution;
- recent Android crash fingerprints;
- Prometheus-compatible internal metrics through the protected scrape path;
- off-box JSON logs when the Fluentd overlay is enabled;
- backup freshness/dead-man monitoring.

Do not promote an Android rollout during an unstable server cutover. Stabilize the web/API release first.

## 6. Android release and staged OTA

Build the player with an explicit immutable identity:

```bash
scripts/build-android-release.sh \
  --api-base-url=https://<production-domain>/api \
  --version-name=<VERSION_NAME> \
  --version-code=<MONOTONIC_CODE>
```

The build command fails closed unless signing credentials are present and verifies the final APK package/version/signature before creating the release artifact.

Then:

1. Publish the immutable APK, checksum, per-version manifest, and discovery pointer.
2. Keep OTA disabled while installing/validating a lab TV.
3. Ensure production TVs are provisioned to allow Wizer package installs.
4. In `/company/settings/android-ota`, pin the exact version name/code.
5. Start with explicit canary screens/groups and `0%` general rollout.
6. Confirm `INSTALLED`, normal heartbeat/playback, and no abnormal crash/offline increase.
7. Promote deliberately through small percentages with a soak period between stages.
8. Halt immediately on abnormal health.

A terminal `BLOCKED`/install failure is sticky for one policy revision. After remediation, explicitly save the policy again to authorize one new attempt. Android rollback is forward-only: publish known-good code under a **higher** versionCode.

## 7. Traffic rollback

If server/API behavior is unhealthy after cutover:

```bash
scripts/rollback-blue-green.sh
```

The rollback command derives the current release from **live Nginx/container state**, not stale deployment history. It health-gates the target before switching and skips releases already recorded as rolled away from, so repeated rollback moves farther back instead of bouncing into a known-bad release.

Database migrations are not automatically reversed during live rollback. This is why every zero-downtime migration must remain compatible with the previous application until the later contract phase.

## 8. Release acceptance

The release is accepted only after all of the following are true:

- public readiness and smoke pass from outside the host;
- EN and AR production-browser smoke passes, including RTL and nonce CSP hydration;
- database backup/restore drill passes on the final migration chain;
- rollback drill is proven against the final blue/green scripts;
- a canary Android TV survives install/restart/offline/cache/playback checks;
- monitoring shows expected app version and no abnormal crash/offline/warning trend;
- there are no unresolved HIGH/CRITICAL dependency or secret-scanning findings.

Record the accepted Git SHA, Android versionName/versionCode, migration tip, backup timestamp, and rollout revision in the release record.
