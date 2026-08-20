# Wizer Signage — Production Readiness Status

Last reconciled: 2026-08-20

Audit baseline: `6a3c0f9` (`main`)

This document is intentionally strict. Wizer is only called **100% production ready** after the final integrated release has passed its real validation gates and the production/device cutover has been exercised successfully. Repository implementation alone is not enough.

## Executive status

- **Original ship blockers 1–19:** COMPLETE.
- **P0 / P1 / P2 implementation:** COMPLETE.
- **Final integration PR #80:** MERGED to `main` on 2026-08-10.
- **Final repository validation gate:** PASSED, and re-passed on every change since.
- **Production activation:** NOT COMPLETE — 6 of the 13 acceptance items below have not started, because they require the production host, registry credentials, an Android signing keystore, or physical hardware.

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

| #   | Item                                                                                      | Status                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Publish immutable API/dashboard/maintenance GHCR images for the exact `main` SHA          | **NOT STARTED** — needs registry write                                                                                                                                                                                                                                                       |
| 2   | Configure host read-only GHCR auth and immutable registry prefix                          | **NOT STARTED** — needs the host                                                                                                                                                                                                                                                             |
| 3   | Run production preflight                                                                  | **NOT STARTED** — needs the host                                                                                                                                                                                                                                                             |
| 4   | Take/verify the pre-migration backup                                                      | Drilled against real PostgreSQL; off-box copy verified (#106) and restorability fixed (#107). **Not yet run on the production host.**                                                                                                                                                        |
| 5   | Blue/green deployment and health-gated traffic switch                                     | Proven against a real Docker daemon and real Nginx. **Not yet run on the production host.**                                                                                                                                                                                                  |
| 6   | Public readiness + smoke checks                                                           | EN/AR browser smoke proven locally (#104). **Not yet run against a live deployment.**                                                                                                                                                                                                        |
| 7   | Off-box backup/logging and private-only metrics                                           | **PROVEN** — backup pulled back from object storage and restored (#106/#107); log delivery exercised against a real collector with a canary for its absence (#108); metrics endpoint verified by request against real Nginx on both templates (#110). Two operator-side rules remain, below. |
| 8   | One-release traffic rollback and service recovery                                         | **PROVEN** — zero downtime across a live rollback (1778 requests, 0 failures)                                                                                                                                                                                                                |
| 9   | Restore a current backup into a non-production target + telemetry physical checks         | **PROVEN** (#101, #107)                                                                                                                                                                                                                                                                      |
| 10  | Build/sign/publish an Android candidate plus a higher-version known-good recovery release | **NOT STARTED** — needs the signing keystore                                                                                                                                                                                                                                                 |
| 11  | Roll out to a physical lab/canary screen and prove healthy heartbeat acceptance           | **NOT STARTED** — needs hardware                                                                                                                                                                                                                                                             |
| 12  | Deliberately exercise the OTA unhealthy-window path and prove automatic recovery          | Proven against a real database (#102). **Not yet on hardware**, which is what item 11 gates.                                                                                                                                                                                                 |
| 13  | Complete final EN/AR production acceptance                                                | **NOT STARTED**                                                                                                                                                                                                                                                                              |

Seven proven or partially proven; six not started. Those six are not blocked on engineering — every one of them waits on the production host, registry credentials, the Android signing keystore, or physical hardware.

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
- **`scripts/rollback-blue-green.sh:29`** assigns `BASE_COMPOSE` and never uses it.

## Definition of 100% for this audit

**100% = implementation complete + final integrated validation green + production cutover/recovery accepted.**

The first two are now met. Until the production cutover and device acceptance are complete, Wizer should be described as **implementation-complete and repository-validated, but not yet production-proven.**
