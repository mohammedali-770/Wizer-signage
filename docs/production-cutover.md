# Wizer Signage production cutover

This is the operator sequence for the first real Wizer Signage production release. It is deliberately ordered so irreversible/mutating steps occur only after the preceding safety gate passes.

## 1. Freeze the release coordinate

- Merge only a protected, green `main` commit.
- Record the full 40-character Git SHA. Production images are immutable SHA artifacts, never rebuilt under the same SHA tag.
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
- `BACKUP_OFFSITE_CMD` — a real off-host copy command, never `true`, `:`, or another no-op
- `HEALTHCHECKS_URL` — an HTTPS dead-man endpoint pinged only after a successful backup

Authenticate Docker to GHCR with a **read-only** package credential. Do not place registry write credentials on the application host.

Run the read-only immutable-coordinate preflight against the SHA you intend to release:

```bash
scripts/production-preflight.sh <FULL_GIT_SHA>
```

It must pass before continuing. It verifies required host tools, Compose rendering, production-like endpoints, secret-length floors, registry/database URL shape, offsite recovery posture, out-of-band backup monitoring, free disk, open-file headroom, and immutable SHA syntax without printing secret values.

> The current blue/green implementation resolves the actual deploy target from the protected `main` branch immediately before image pull. The SHA argument above validates and records the intended release coordinate; it is not a positional argument consumed by `deploy-blue-green.sh`. Before cutover, verify protected `main` still equals the recorded SHA. A future hardening can make the deploy script enforce `EXPECTED_RELEASE_SHA` internally; until that is validated, do not imply positional SHA pinning that the script does not implement.

## 3. Backup and migration safety

The blue/green deploy path takes the mandatory database backup before migrations. Production preflight refuses to begin unless the backup has both a real off-host copy command and external dead-man monitoring.

A complete database dump contains both Wizer-owned schemas:

- `public` — business data and canonical Prisma-visible telemetry parents;
- `wizer_telemetry` — monthly child partitions and proof-of-play idempotency state.

The migration must satisfy the repository's expand/backfill/contract compatibility guard; a deployment that requires immediately dropping/renaming live application columns is not a zero-downtime deployment.

For the telemetry-partition migration, perform the first conversion during the agreed pre-production/maintenance window because it intentionally takes an exclusive table lock while it copy/swaps existing telemetry into partitioned parents. Validate the resulting parent/child/trigger/session-registry catalog before proceeding.

## 4. Deploy through the mandatory wrapper

Use:

```bash
scripts/deploy-production.sh
```

Do not call `deploy-blue-green.sh` directly during normal operations. The wrapper runs the mandatory production preflight first and then the blue/green deploy resolves the current protected `main` SHA, verifies/pulls its immutable images, and records that SHA in deployment history.

Expected sequence:

1. Resolve protected `main` and verify/pull the immutable release images.
2. Take the pre-migration database backup and complete its off-host copy.
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
- Prometheus-compatible internal metrics by connecting directly to the API container/private Compose network with `METRICS_TOKEN` — the public Nginx path must return 404;
- off-box JSON logs through the Fluentd-compatible collector when the logging overlay is enabled;
- backup freshness and the external dead-man monitor.

Off-box logging is a required **production acceptance** check even though its Compose overlay remains deliberately opt-in until the collector endpoint is configured and validated. Do not claim the observability cutover accepted while only local container logs exist.

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

Before arming OTA, publish **two** immutable releases:

1. the candidate build;
2. a known-good recovery build with a strictly **higher** `versionCode` than the candidate so Android can recover forward without downgrade semantics.

Then:

1. Keep OTA disabled while installing/validating a lab TV.
2. Ensure production TVs are provisioned to allow Wizer package installs.
3. In `/company/settings/android-ota`, pin the exact candidate and known-good recovery versions.
4. Start with explicit canary screens/groups and `0%` general rollout.
5. Confirm the candidate reports `INSTALLED` and then a clean post-install heartbeat/playback state inside the configured health window.
6. Promote deliberately through small percentages with a soak period between stages.
7. Verify the one-minute maintenance reconciliation is running.
8. Deliberately exercise the unhealthy-health-window path on a lab/canary and prove the policy atomically moves the same cohort to the pre-staged higher-version known-good release.

A terminal `BLOCKED`/install failure is sticky for one policy revision. After remediation, explicitly save the policy again to authorize one new attempt. A concurrent operator save must win over a stale automatic-recovery worker.

## 7. Traffic rollback

If server/API behavior is unhealthy after cutover:

```bash
scripts/rollback-blue-green.sh
```

The rollback command derives the current release from **live Nginx/container state**, not stale deployment history. It health-gates the target before switching and skips releases already recorded as rolled away from, so repeated rollback moves farther back instead of bouncing into a known-bad release.

Database migrations are not automatically reversed during live rollback. This is why every zero-downtime migration must remain compatible with the previous application until the later contract phase.

## 8. Database recovery acceptance

A generic table round trip is not enough after telemetry partitioning. On the exact final migration chain:

1. run the real backup script;
2. restore the dump into a separate PostgreSQL 16 target;
3. require the restored child-partition count to match the source;
4. run:

```bash
DIRECT_URL="$RESTORED_DATABASE_URL" bash scripts/assert-telemetry-partitions.sh
DIRECT_URL="$RESTORED_DATABASE_URL" bash scripts/assert-telemetry-partition-isolation.sh
```

The repository's `scripts/tests/telemetry-backup-restore-drill.sh` performs this migrated-schema recovery test inside the existing quality gate; no separate CI runner is required.

## 9. Release acceptance

The release is accepted only after all of the following are true:

- public readiness and smoke pass from outside the host;
- EN and AR production-browser smoke passes, including RTL and nonce CSP hydration;
- final generated OpenAPI/dashboard types match the exact release tree;
- database backup/restore drill passes on the final migration chain, including `public` + `wizer_telemetry` and physical partition verifiers;
- rollback drill is proven against the final blue/green scripts;
- private metrics scrape works while the public metrics URL remains inaccessible;
- off-box JSON log collection is visible at the external collector;
- backup dead-man monitoring receives the successful backup signal;
- a canary Android TV survives install/restart/offline/cache/playback checks;
- the deliberate OTA unhealthy-health-window recovery drill succeeds;
- monitoring shows the expected app version and no abnormal crash/offline/warning trend;
- there are no unresolved HIGH/CRITICAL dependency or secret-scanning findings.

Record the accepted Git SHA, Android versionName/versionCode, recovery versionCode, migration tip, backup timestamp, and rollout revision in the release record.
