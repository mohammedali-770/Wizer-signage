# Wizer Signage — Production Readiness Status

Last reconciled: 2026-08-27

Audit baseline: `2047f2c` (`main`)

This document is intentionally strict. Wizer is only called **100% production ready** after the final integrated release has passed its real validation gates and the production/device cutover has been exercised successfully. Repository implementation alone is not enough.

## Executive status

- **Original ship blockers 1–19:** COMPLETE.
- **P0 / P1 / P2 implementation:** COMPLETE.
- **Final integration PR #80:** MERGED to `main` on 2026-08-10.
- **Final repository validation gate:** PASSED, and re-passed on every change since.
- **Production activation:** NOT COMPLETE — 6 of the 13 acceptance items below have not started, because they require the production host, a captcha key pair, an Android signing keystore, or physical hardware.

The remaining work is not feature development and no longer repository validation. It is production/device acceptance on real infrastructure.

## What "INTEGRATED" turned out to mean

This is the most important correction in this reconciliation, and it argues for the document's strictness rather than against it.

Between 2026-08-19 and 2026-08-20 the merged tree was exercised by eight drills — running the actual scripts against real Docker, real PostgreSQL, real Nginx, a real Fluentd collector and real object storage, rather than reading them or trusting their tests. **Six of the eight found defects in work this table had already marked COMPLETE or INTEGRATED**, every one of them in code that was merged, reviewed and green in CI. One of those six found two separate defects, so the table below has seven rows.

| Drill                    | What was already "complete" | What it actually did                                                                                                                                             |
| ------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blue/green rollback      | Rollback                    | Could target the slot already serving; a rolled-away tag was never cleared (#100)                                                                                |
| Backup restore           | Backup/restore boundary     | The dump could not be restored into a migrated database, and the failed attempt left **0 foreign keys** — worse than before (#101)                               |
| Rollback vs. real Docker | Blue/green deploy           | `fluentd-retry-wait: 1` was rejected at container create; no slot could start at all (#103)                                                                      |
| Off-box backup           | Off-box copy                | The maintenance image contained **no tool that could copy a file off the host**; the only transfer path truncated a gzip dump to **3 bytes** and exited 0 (#106) |
| Restore, again           | Backup/restore boundary     | The image shipped pg_dump 18 against a PostgreSQL 16 server, so **every dump was unrestorable** (#107)                                                           |
| Off-box logging          | First-party observability   | A dead collector delivered **0 of 33 lines** with no error anywhere; log shipping had never been exercised beyond grepping YAML (#108)                           |
| Metrics endpoint         | Private Prometheus metrics  | The public-edge tombstone was an exact match, and the API answers to several spellings; two variants reached it through the public edge (#110)                   |

The common shape: each mechanism's only verification was a proxy — an exit status, a mock, a string match on a config file — rather than the real post-condition. A dump that exists is not a dump that restores. An upload that exits 0 is not an upload that arrived.

The two drills that found nothing are worth recording as well, because they are what makes the rest meaningful: the OTA unhealthy-recovery path behaved correctly against a real database and only needed coverage added (#102), and the EN/AR browser journey passed, though it did surface that the app and the proxy each send a Content-Security-Policy header and the effective policy is their intersection, which is now pinned (#104).

Two further defects were found in CI itself: the nightly k6 job had **failed for six consecutive nights without anyone noticing**, and had in fact never once executed the smoke it exists to run (#109); and the reporting added to fix that silence was itself silent on its first run (#110).

**Read the table below accordingly.** "Proven" here means exercised end to end against real infrastructure. "Implemented" means the code exists and its tests pass, which this engagement has repeatedly shown is a weaker claim than it appears.

## Final repository validation gate — PASSED

PR #80 merged on 2026-08-10 after passing the full gate: quality on PostgreSQL 16 (migrations from empty, strict Prisma drift, lint, typecheck, unit, real HTTP/Postgres e2e, telemetry partition/isolation e2e, backup regressions, real backup/restore drill across both schemas, rollback/deploy/Nginx regressions, OpenAPI freshness, production dashboard build); Docker API/dashboard/maintenance images; Android tests/lint/debug build; dependency audit and secret scanning; EN/AR production browser smoke with nonce CSP; and the generated API contract.

Every change merged since has re-passed the same four required checks. No CI bypass has been used, and no check has been merged around.

The GitHub Actions billing blocker recorded in the previous revision of this document is resolved; runners have been assigned normally throughout.

## Post-merge production acceptance

Even a fully green repository is not the final 100%.

| #   | Item                                                                                      | Status                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Publish immutable API/dashboard/maintenance GHCR images for the exact `main` SHA          | **NOT STARTED** — needs a captcha site key. No separate registry credential is required: `release-images.yml` publishes with `secrets.GITHUB_TOKEN` and `packages: write`, so a repository owner can run it from the Actions UI. What gates it is `captcha_site_key`, a required workflow input baked irreversibly into the dashboard image |
| 2   | Configure host read-only GHCR auth and immutable registry prefix                          | **NOT STARTED** — needs the host                                                                                                                                                                                                                                                                                                            |
| 3   | Run production preflight                                                                  | **NOT STARTED** — needs the host                                                                                                                                                                                                                                                                                                            |
| 4   | Take/verify the pre-migration backup                                                      | Drilled against real PostgreSQL; off-box copy verified (#106) and restorability fixed (#107). **Not yet run on the production host.**                                                                                                                                                                                                       |
| 5   | Blue/green deployment and health-gated traffic switch                                     | Proven against a real Docker daemon and real Nginx. **Not yet run on the production host.**                                                                                                                                                                                                                                                 |
| 6   | Public readiness + smoke checks                                                           | EN/AR browser smoke proven locally (#104). **Not yet run against a live deployment.**                                                                                                                                                                                                                                                       |
| 7   | Off-box backup/logging and private-only metrics                                           | **PROVEN** — backup pulled back from object storage and restored (#106/#107); log delivery exercised against a real collector with a canary for its absence (#108); metrics endpoint verified by request against real Nginx on both templates (#110). Two operator-side rules remain, below.                                                |
| 8   | One-release traffic rollback and service recovery                                         | **PROVEN** — zero downtime across a live rollback (1778 requests, 0 failures)                                                                                                                                                                                                                                                               |
| 9   | Restore a current backup into a non-production target + telemetry physical checks         | **PROVEN** (#101, #107)                                                                                                                                                                                                                                                                                                                     |
| 10  | Build/sign/publish an Android candidate plus a higher-version known-good recovery release | **NOT STARTED** — needs the signing keystore                                                                                                                                                                                                                                                                                                |
| 11  | Roll out to a physical lab/canary screen and prove healthy heartbeat acceptance           | **NOT STARTED** — needs hardware                                                                                                                                                                                                                                                                                                            |
| 12  | Deliberately exercise the OTA unhealthy-window path and prove automatic recovery          | Proven against a real database (#102). **Not yet on hardware**, which is what item 11 gates.                                                                                                                                                                                                                                                |
| 13  | Complete final EN/AR production acceptance                                                | **NOT STARTED**                                                                                                                                                                                                                                                                                                                             |

Seven proven or partially proven; six not started. Those six are not blocked on engineering — every one of them waits on the production host, a captcha key pair, the Android signing keystore, or physical hardware.

> **Item 1's blocker was previously recorded as "registry write", which was wrong** and would have sent an operator looking for a credential they do not need. The release workflow authenticates to GHCR with the automatic `GITHUB_TOKEN`. The real gate is the captcha site key, and because it is compiled into the dashboard bundle it must be correct _before_ item 1 runs rather than fixed afterwards — which is what makes it the first thing to obtain, not the last.

## Operator prerequisites

These cannot be satisfied from the repository and gate the items above.

**Host configuration.** Production preflight now requires more than it did before this engagement: `pg_dump` and `timeout` present on the host, the maintenance image resolvable locally, the log collector reachable from the host (or an explicit `ALLOW_UNREACHABLE_LOG_COLLECTOR=1`), and `BACKUP_OFFSITE_VERIFY_CMD` set. Three values fail late and expensively if wrong: `BACKUP_OFFSITE_VERIFY_CMD`, `CAPTCHA_SECRET` (the API refuses to boot without it), and `NEXT_PUBLIC_CAPTCHA_SITE_KEY` — which is compiled into the dashboard image at build time, so it is an input to item 1 and cannot be corrected later by editing `.env`.

**Two half-built alarms.** Both detect failure today but not disappearance, which is the failure mode that produced six silent nights:

- a collector-side rule matching `wizer.log-shipping.canary` that pings a dead-man URL — without it the canary is just another log line;
- the `NIGHTLY_HEALTHCHECK_URL` repository secret — without it a nightly that stops running raises no alarm, and GitHub disables scheduled workflows after 60 days of repository inactivity.

**Dependabot alerts.** Whether _Dependabot alerts_ and _Dependabot security updates_ are enabled could not be determined from this session and needs repository admin. It matters more than usual while version updates are frozen for the cutover, since security updates are the only remaining automatic channel.

**The cutover freeze is temporary.** `.github/dependabot.yml` pins all six ecosystems to `open-pull-requests-limit: 0` with the prior values recorded in its header. Reverse it after the cutover.

## Known limitations recorded rather than fixed

- **Off-box logs are lossy by design.** `fluentd-async` drops a large fraction of logs during a collector outage — measured at ~73% over ten seconds — and does not flush the tail when a container exits. The buffer limit does **not** control this; it counts events, not bytes, and raising it changes nothing measurable. Local `docker logs` retains what the off-box copy drops. During an incident the host is the fuller record.
- **Preflight compares host against image, not against the live server.** The PostgreSQL client major is pinned to 16 by a test tied to CI's Postgres service. On a server upgrade, `Dockerfile.maintenance` and the host package must move together; what catches a stale pin is that test and this note, not the preflight.
- **A base-image advisory turns a green tree red with no commit.** Trivy refreshes its vulnerability database every run and the gate has no grace period. That is deliberate — `ignore-unfixed: true` means it fires only where a patch already exists — but it means a tree that passed yesterday can fail today on nothing the repository did. Expect it after any long gap between builds, and read it as work rather than as a broken gate.

## Corrections — 2026-08-27

Three further defects, merged as PR #112 (`2047f2c`). They are recorded together because what distinguishes them is not severity but **how each was found** — and none of the three was reachable by the eight drills above.

### 1. The rollback left the maintenance worker on the release it rolled away from

The previous revision of this document listed `scripts/rollback-blue-green.sh:29` under known limitations as a harmless dead assignment: "assigns `BASE_COMPOSE` and never uses it." It was not harmless, and it fits the pattern the drill table describes exactly.

`deploy-blue-green.sh:263` moves the **maintenance** container onto the new release image after the public gates pass. `rollback-blue-green.sh` rolled back the API, the dashboard and the Nginx upstreams and never touched it, so every rollback left the nightly `backup-db.sh`, the TLS expiry check and the log-shipping canary running the release that had just been judged bad. `BASE_COMPOSE` is the handle the rollback needs to bring maintenance back; it was assigned and the step was never written, which is why the variable read as dead code rather than as a missing operation.

Two of the seven defects in the table above were in that exact component — the `pg_dump` 18-against-16 dumps that could not be restored (#107) and the transfer path that truncated a dump to 3 bytes and exited 0 (#106). A rollback triggered by either would have restored traffic and left the broken backup worker running: the outage reads as resolved while the data protection is still broken.

Fixed: the rollback returns the worker to the target release after the public gates accept it, verifying the image's `org.opencontainers.image.revision` and re-pulling from the registry when the host no longer has it. It then waits for the container to report healthy, because `docker compose up -d` returns when a container has _started_, which is not the same as cron running. If any of that fails the script reports `PARTIAL ROLLBACK` and exits non-zero — traffic restored, worker not — rather than reporting a clean rollback. The legacy fallback is exempt: it records no release to return to, and refusing there would break the last escape hatch.

**Found by reading the script.** No drill asserts the maintenance container's image after a rollback, so no amount of drilling the existing set would have surfaced it.

### 2. Five variables preflight requires were absent from `.env.example`

`scripts/production-preflight.sh` hard-requires twenty environment values. `IMAGE_REGISTRY_PREFIX`, `METRICS_TOKEN`, `BACKUP_OFFSITE_CMD`, `BACKUP_OFFSITE_VERIFY_CMD` and `HEALTHCHECKS_URL` appeared nowhere in the template. An operator copying it, filling it in and running preflight met five sequential hard failures for variables the template never named — each a separate round trip, before a single image was pulled.

This is the same fails-late-and-expensively shape the drill table documents, one step earlier: at the template rather than at the deploy. Each is now documented with the contract preflight enforces, because four of the five have a non-obvious one — most of all `BACKUP_OFFSITE_CMD`, which runs both on the host and inside the maintenance container, so anything it names must exist in both.

**Found by diffing preflight's requirements against the template.** Nothing does that automatically, and nothing in CI would: preflight never runs in CI, because it needs a host.

### 3. The dashboard image shipped a stale OpenSSL

Trivy failed `wizer-signage/dashboard:ci` on `libcrypto3` and `libssl3` at 3.5.7-r0 — CVE-2026-14456, fixed upstream in 3.5.8-r0. This was failing `main`, not the branch that surfaced it.

The structural part will recur. The API and maintenance runtime stages run `apk add --no-cache openssl`, which pulls `libcrypto3`/`libssl3` forward as dependencies at whatever the index currently holds. The dashboard runner stage installed nothing with apk at all, so it kept precisely what `node:26-alpine` was built with. The API's Trivy step passed in the same job the dashboard's failed: the two images never differed in exposure, only in whether anything ever refreshed the package. The dashboard was always going to be the one that rotted.

Fixed by refreshing those two packages explicitly, which is what the other two images already got incidentally. Deliberately not suppressed — the gate runs `ignore-unfixed: true`, so it fires only where a patch exists, and this repository has no `.trivyignore` and should not acquire one for a HIGH that has a fix.

**Found by CI on a tree that had been green.** No local check can anticipate this one; the advisory did not exist when the tree last passed.

### What the three have in common

Each was invisible to the mechanism that should have owned it. The rollback defect was invisible to the drills, because no drill looks at that container. The template gap was invisible to CI, because preflight cannot run without a host. The OpenSSL finding was invisible to every local check, because it arrived from outside the repository.

The drill table's lesson was that a mechanism verified by a proxy is not verified. These add a second: **a mechanism nothing verifies at all is easy to mistake for one that passes.** Two of the three had been sitting in merged, reviewed, green code — one of them written into this document as a known limitation and dismissed.

## Definition of 100% for this audit

**100% = implementation complete + final integrated validation green + production cutover/recovery accepted.**

The first two are now met. Until the production cutover and device acceptance are complete, Wizer should be described as **implementation-complete and repository-validated, but not yet production-proven.**
