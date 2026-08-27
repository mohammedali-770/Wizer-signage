# Wizer Signage production cutover

This runbook is the mandatory sequence for the first real Wizer Signage production release. Mutating steps occur only after the preceding safety gate passes.

## 1. Freeze one release

- Merge only a protected, green `main` commit.
- Record its full 40-character SHA and freeze `main` for the cutover window.
- Publish API, dashboard and maintenance images from that exact SHA to GHCR via
  the `Release production images` workflow. It takes `api_url`,
  `captcha_site_key` and `captcha_provider` as inputs; all three are baked into
  the dashboard bundle and none can be changed without rebuilding.
- Never rebuild or replace an image under an existing SHA tag.

## 2. Prepare the production host

The production `.env` must contain real values for at least:

- `APP_DOMAIN`
- `DATABASE_URL` and `DIRECT_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`
- `IMAGE_REGISTRY_PREFIX=ghcr.io/<owner>`
- `METRICS_TOKEN` (32+ characters)
- `BACKUP_OFFSITE_CMD` — a real off-host copy command, not `true`, `:`, `echo`, or another no-op
- `BACKUP_OFFSITE_VERIFY_CMD` — prints the **remote** object's size in bytes; `backup-db.sh`
  compares it against the local dump and fails the run on mismatch
- `HEALTHCHECKS_URL` — an HTTPS dead-man endpoint pinged only after a successful backup

> **The offsite command runs in two filesystems.** `backup-db.sh` executes on the host at
> deploy time and inside the maintenance container on the nightly cron schedule, so anything
> the command names must exist in both. Only `rclone` is installed in that image — `aws`,
> `curl`, `scp`, `ssh` and `rsync` are not. Preflight resolves the command's first word
> inside the maintenance image so a command that works when tested by hand cannot go on to
> fail, or silently transfer nothing, every night.
>
> **The PostgreSQL client major must match the production server major (16).** `pg_dump`
> 17+ emits `SET transaction_timeout = 0;`, which PostgreSQL 16 rejects, and `restore-db.sh`
> runs `psql --set ON_ERROR_STOP=on` — so a dump from a newer client aborts before any row
> is applied. Preflight compares the host client against the maintenance image's.
>
> Verification is separate from the copy for a reason: a zero exit is not evidence that
> bytes arrived. Busybox `wget --post-file` truncates a gzip dump at its first NUL byte and
> exits 0, which produced a 3-byte "backup" while the run logged success, pinged the
> dead-man and pruned older local copies.

- `CAPTCHA_SECRET` — the API **refuses to boot** without it in production, because the
  unauthenticated trial-signup endpoint must not be served without human verification.
  `CAPTCHA_PROVIDER` selects `turnstile` (default), `recaptcha` or `hcaptcha`.

> **The dashboard's captcha key is NOT set here.** `NEXT_PUBLIC_CAPTCHA_SITE_KEY`
> is inlined into the dashboard bundle at image build time, exactly like
> `NEXT_PUBLIC_API_URL`, so it is an input to the release-images workflow in §1
> and cannot be fixed later by editing `.env`. Get it wrong and the deploy
> succeeds while every public form submission fails: the widget is absent, so no
> token is sent, and the API rejects the request. Both halves come from the same
> provider account — the site key is public, the secret is server-only and must
> never appear as a `NEXT_PUBLIC_*` variable.

Authenticate Docker to private GHCR with a **read-only** package credential. The application host must not have registry write credentials.

Run the read-only preflight:

```bash
scripts/production-preflight.sh <FULL_GIT_SHA>
```

It verifies host tools, Docker/Compose, production-like endpoints, database/registry shape, secret floors, offsite recovery posture, dead-man monitoring, Compose rendering, free disk, open-file headroom and immutable SHA syntax without printing secret values.

## 3. Deploy only through the production wrapper

Use the same accepted SHA:

```bash
scripts/deploy-production.sh <FULL_GIT_SHA>
```

The wrapper:

1. reruns production preflight for that SHA;
2. resolves `refs/heads/main` directly from `origin`;
3. aborts before image pull/migration if remote protected `main` no longer equals the accepted SHA;
4. hands off to the blue/green deploy only after those checks pass.

Do not call `deploy-blue-green.sh` directly during normal production operations.

## 4. Backup and migration safety

The deploy takes a mandatory database backup before migrations. Production preflight prevents the release from starting unless off-host backup copy and external dead-man monitoring are configured.

A complete Wizer dump includes both owned schemas:

- `public` — business data and the canonical Prisma-visible telemetry parents;
- `wizer_telemetry` — monthly child partitions and proof-of-play idempotency state.

The zero-downtime path rejects common destructive migration shapes unless an explicit maintenance-window override is used. The first telemetry copy/swap conversion is intentionally a pre-production maintenance operation because it takes exclusive table locks.

## 5. Blue/green cutover sequence

Blue/green is an **adoption path on a host already running the base stack**, not a
greenfield topology. The first deploy recreates Nginx with the blue/green template
and a persistent runtime volume, and the entrypoint seeds that volume with upstreams
pointing at the running `api` / `dashboard` services so traffic keeps flowing until
the first slot switch. Those two containers must therefore already be up.

On a host where they are not — a fresh staging box, a rebuild after a disaster —
Nginx refuses to start at all:

```
[emerg] host not found in upstream "api:3001" in /etc/nginx/runtime/active-upstreams.conf
```

and the deploy aborts on the next `docker exec`. Bring the base stack up first on any
such host. `deploy-blue-green.sh` starts Nginx with `--no-deps` and never starts those
services itself.

The expected deployment order is:

1. Resolve protected `main` and verify/pull immutable images.
2. Take the pre-migration backup and complete its off-host copy.
3. Apply forward-compatible migrations while the old slot still serves.
4. Start the inactive API/dashboard slot.
5. Wait for container health/readiness.
6. Atomically switch the persistent Nginx upstream file and gracefully reload Nginx.
7. Run public readiness and smoke tests.
8. Automatically restore the previous upstream if the post-switch gate fails.
9. Drain the old API while keeping the previous dashboard temporarily available for old hashed `/_next/static` assets.
10. Record deployment history only after the public gate succeeds.

## 6. Observe the server release

Immediately verify:

- external `/api/health/ready`;
- monitoring online/offline/warning counts;
- failed syncs;
- player version distribution;
- recent Android crash fingerprints;
- private Prometheus scrape directly against the API/container network with `METRICS_TOKEN`;
- public `/api/internal/metrics` returns 404;
- off-box JSON logs are visible at the external collector;
- backup freshness and the external dead-man monitor are healthy.

The Fluentd-compatible logging overlay is intentionally opt-in until its collector is configured, but **off-box logs are mandatory for final production acceptance**. Do not call the observability cutover complete with only local container logs.

Do not promote an Android rollout while the server cutover is unstable.

## 7. Android staged OTA

Build with explicit immutable identity:

```bash
scripts/build-android-release.sh \
  --api-base-url=https://<production-domain>/api \
  --version-name=<VERSION_NAME> \
  --version-code=<MONOTONIC_CODE>
```

Before enabling OTA publish two immutable releases:

1. the candidate;
2. a known-good recovery build with a strictly **higher** `versionCode` than the candidate.

Then:

1. Validate the candidate manually on a lab TV with OTA disabled.
2. Ensure the TV is provisioned for Wizer package installation.
3. Configure the exact candidate/recovery versions in `/company/settings/android-ota`.
4. Start with explicit canary screens/groups and `0%` general rollout.
5. Require `INSTALLED` plus a clean post-install heartbeat/playback state within the configured health window.
6. Promote through small percentages with deliberate soak periods.
7. Verify the one-minute `android-ota-health` maintenance reconciliation is running.
8. Deliberately make a lab/canary miss the health window and prove the policy atomically advances the same cohort to the pre-staged higher-version known-good release.

Terminal install failures are sticky per policy revision. After remediation, save a new policy revision. A concurrent operator save must win over stale automatic recovery work.

Step 8 is also checked automatically. `apps/api/test/android-ota-recovery.e2e-spec.ts` runs the real reconciliation against the CI database and proves the recovery transition end to end: the cohort advances to the pre-staged higher-version build and is carried over unwidened, the spent rollback coordinate is cleared so a rollout cannot resume unarmed, unrelated company settings survive the write, a second sweep does nothing, a healthy canary is untouched, a missing recovery artifact halts instead of reverting, and an operator saving mid-sweep wins the race. Running it on the lab TV still matters — only that proves the player installs and reports what the server expects — but the server-side half no longer depends on remembering to check it.

## 8. Traffic rollback

For an unhealthy server/API release:

```bash
scripts/rollback-blue-green.sh
```

Rollback derives current state from live Nginx/container state, health-gates the previous target, restores original traffic if validation fails, and skips releases already recorded as rolled away from. Run it repeatedly to step farther back: each run excludes both the release currently serving and every release escaped earlier, so it never toggles between two releases.

The target release is always brought up on the slot that is **not** serving, whichever slot it originally ran on. A slot tag is only a pointer to an immutable release image, so a rollback is a deploy of an older release into the standby slot followed by the usual health-gated switch — it never recreates the containers handling live traffic. If legacy is serving and every blue/green release is either live or excluded, there is nothing to switch to and the script refuses rather than restarting the serving containers in place.

**The maintenance worker moves with the rollback.** `deploy-blue-green.sh` updates the maintenance container to the new release image once the public gates pass, so a rollback has to put it back or the nightly `backup-db.sh`, the TLS expiry check and the log-shipping canary keep running the release just escaped. Two releases in this repository's history were bad in exactly that component — one shipped a `pg_dump` major the production server rejects, so every dump was unrestorable, and one shipped a transfer path that truncated a gzip dump to 3 bytes and exited 0 — which is precisely the state in which rolling the app back and leaving the backup worker alone reads as a resolved outage while the data protection is still broken.

The worker is health-gated like any other container: `docker compose up -d` returns when it has _started_, which is not the same as `crond` running, so the rollback waits for it to report healthy before calling itself clean. If the worker cannot be returned — its release image is absent from the host and no `IMAGE_REGISTRY_PREFIX` is configured, or it starts and fails its health check — the script reports **PARTIAL ROLLBACK** and exits non-zero after traffic is already restored, printing the two commands that recover it. Traffic being correct is not enough to call the rollback clean. The legacy fallback is the one exception: it records no release to return to, so a worker that never moved onto the escaped release is left alone rather than blocking the last escape hatch.

**When a release stops being excluded.** The exclusion is not permanent. It is superseded by a later deployment of that same release: `deploy-blue-green.sh` records a release only after it has passed the public readiness and smoke gates, so a deployment newer than the rollback-away entry is evidence the release serves correctly again. This matters when the original outage was environmental — a bad migration, an expired credential, a failed upstream — rather than a fault in the code, which would otherwise strand a perfectly good release as unreachable forever.

Deploying a _different_ release clears nothing — it says nothing about the excluded one. The only way to clear an exclusion is to deploy that same release again, through the wrapper in section 3 with the SHA that was excluded.

Because the wrapper accepts a SHA only while it still equals protected `main`, this covers the case that matters and no more: a release rolled back for an environmental fault, redeployed once the environment is repaired, with `main` never having moved. Once `main` has advanced past a release, that release stays excluded — which is the intended reading, since its code has been superseded by whatever fixed it.

If repeated rollbacks have excluded everything and the script reaches the `legacy` fallback, the situation is no longer a traffic rollback: go to section 9.

Database migrations are not reversed automatically. This is why every live rollout migration must remain compatible with the previous application until a later contract phase.

## 9. Database recovery acceptance

On the exact final migration chain, prove the actual migrated schema survives backup and restore:

1. dump with the real `backup-db.sh`;
2. restore into a separate PostgreSQL 16 target;
3. require restored telemetry child count to match the source;
4. run:

```bash
DIRECT_URL="$RESTORED_DATABASE_URL" bash scripts/assert-telemetry-partitions.sh
DIRECT_URL="$RESTORED_DATABASE_URL" bash scripts/assert-telemetry-partition-isolation.sh
```

`scripts/tests/telemetry-backup-restore-drill.sh` performs this migrated-schema recovery inside the existing quality gate; it does not consume another CI runner. It restores the dump **twice** — once into an empty target and once over the schema it just created — because only the second case exercises disaster recovery against a database that already exists.

`restore-db.sh` renames the Wizer-owned schemas aside and restores into the freed names rather than applying the dump over the live schema, and puts them back if anything fails. See `docs/backup-restore.md` for why a dump cannot be applied over an existing migrated schema.

## 10. Final acceptance

The release is accepted only when all are true:

- protected final CI is green on the exact release head;
- generated OpenAPI/dashboard types match that head;
- external public readiness/smoke passes;
- EN/AR production browser smoke passes with RTL + nonce CSP;
- both-schema database restore and telemetry physical checks pass;
- one-release traffic rollback is proven;
- private metrics work and the public metrics endpoint remains inaccessible;
- off-box JSON logs are visible, **and** the log-shipping canary is arriving at the
  collector with its dead-man rule configured — one line arriving proves the path worked
  once, not that anyone would notice when it stops;
- external backup dead-man monitoring receives a successful backup signal;
- the off-box copy of that backup is **pulled back and restored**, not merely reported as
  uploaded — a stored object is only a backup once it has been read back and applied;
- physical Android canary install/restart/offline/cache/playback checks pass;
- deliberate OTA unhealthy-window automatic recovery succeeds;
- monitoring shows the expected version with no abnormal crash/offline/warning trend;
- no unresolved HIGH/CRITICAL dependency or secret-scanning finding remains.

Record the accepted Git SHA, Android candidate/recovery version codes, migration tip, backup timestamp and rollout revision in the release record.
