# Wizer Signage — Production Readiness Status

Last reconciled: 2026-08-09

Audit baseline: `7f256d6`

This document is intentionally strict. Wizer is only called **100% production ready** after the final integrated release has passed its real validation gates and the production/device cutover has been exercised successfully. Repository implementation alone is not enough.

## Executive status

- **Original ship blockers 1–19:** COMPLETE.
- **P0 implementation:** COMPLETE.
- **P1 implementation/security correctness:** COMPLETE.
- **P2 implementation:** COMPLETE on `codex/production-readiness-final`, subject to the final integrated validation below.
- **Final integration PR:** #80 (`codex/production-readiness-final` → `main`) — DRAFT by design.
- **Production activation:** NOT YET COMPLETE.

The remaining work is no longer feature development. It is validation of the exact integrated tree, merge to `main`, then real production/device acceptance.

## Final integrated readiness work

| Area | Repository status | Evidence |
| --- | --- | --- |
| Original 19 ship blockers | COMPLETE | Earlier merged readiness PRs through #71 |
| HttpOnly refresh session | COMPLETE | PR #69 |
| Nonce-backed production CSP | COMPLETE | PR #70 |
| Tenant-scoped proof-of-play idempotency | COMPLETE | PR #71 |
| Full EN/AR Playwright production journey | INTEGRATED | PR #72 — login → screens → create screen → upload → schedule, RTL + nonce CSP |
| Generated dashboard OpenAPI types | INTEGRATED, FINAL REGEN PENDING | PR #73 merged into final integration with exact pinned generator; final generated file must be refreshed from the exact final OpenAPI tree |
| Android staged OTA + automatic health recovery | INTEGRATED | PR #74 — immutable candidate/recovery artifacts, canaries/percentage, policy revision, one-minute health reconciliation, automatic forward recovery |
| Blue/green zero-downtime deployment | INTEGRATED | PR #75 — preflight, immutable images, inactive-slot health gate, atomic Nginx switch, drain, public smoke, state-aware rollback |
| Monthly telemetry partitioning | INTEGRATED | PR #76 — public Prisma parents, `wizer_telemetry` internals, global PoP registry, future-partition maintenance, real-Postgres tests |
| Android failure-path depth | INTEGRATED | PR #77 — timeout/401/429/5xx/malformed/truncation, cache recovery, playback/watchdog tests, stale-download cleanup |
| First-party observability | INTEGRATED | PR #78 — JSON logs, private Prometheus metrics, bounded browser/Android error telemetry, fleet version/crash diagnostics |
| Scalable server-side selectors | INTEGRATED | PR #81 (replacement integration PR for former draft #79) — bounded search across the remaining high-cardinality selectors |
| Immutable GHCR release path | CODE COMPLETE | PR #67 — production activation still required |
| Per-plan retention / k6 / backup drills / i18n / complete OpenAPI | COMPLETE | Earlier merged P1/P2 PRs tracked in issue #68 |

## Important final-integration corrections

### OTA + observability/failure-path merge

The final tree explicitly preserves all three overlapping concerns:

- Android release version/signing + MockWebServer test dependency;
- `PlayerContainer` wires both crash telemetry and the OTA controller;
- route-exposure regression includes crash telemetry, metrics, OTA policy/result and Android download routes.

### Telemetry partition ownership

Prisma owns the canonical partition parents in `public`; PostgreSQL-only children and the PoP session registry live in `wizer_telemetry`. No broad Prisma drift bypass is permitted.

Maintenance keeps future partitions prepared daily while OTA health reconciliation runs every minute; both jobs coexist in the final crontab.

### Backup/restore boundary

A static final-integration audit found that `backup-db.sh` still dumped only `public` after partition internals had moved to `wizer_telemetry`. That would have produced an apparently successful but incomplete disaster-recovery dump.

The final branch now:

- dumps `public` **and** `wizer_telemetry`;
- regression-pins both pg_dump schema selectors;
- extends the real Docker backup/restore drill to delete and restore an internal telemetry object/data;
- documents both post-restore telemetry physical-schema checks.

This recovery fix must pass the final real-Postgres/Docker gate before merge.

## Current validation blocker

GitHub-hosted Actions are currently blocked at the account/billing layer, not by a known source failure. The final PR jobs are created but receive no runner and execute zero steps (`runner_id = 0`, empty step list). GitHub's check annotation reports that recent account payments failed or the Actions spending limit needs to be increased.

Do **not** repeatedly rerun these jobs while that condition remains. Once GitHub can assign a runner, validate only the latest final head.

## Final repository validation gate

PR #80 must remain draft until the exact integrated head genuinely passes:

1. **Quality / PostgreSQL 16**
   - frozen dependency install;
   - Prisma client generation;
   - full migration chain from empty PostgreSQL 16;
   - strict Prisma drift check;
   - lint + TypeScript typecheck;
   - unit tests;
   - real HTTP/Postgres e2e;
   - telemetry partition/isolation e2e;
   - backup script regressions;
   - real backup/restore drill covering `public` + `wizer_telemetry`;
   - rollback/deploy/Nginx regressions;
   - OpenAPI freshness;
   - production dashboard build.

2. **Docker images**
   - API;
   - dashboard;
   - maintenance.

3. **Android**
   - unit/failure-path tests;
   - lint;
   - debug build.

4. **Security**
   - dependency audit;
   - secret scanning.

5. **Production browser smoke**
   - English and Arabic;
   - login → screens → create screen → upload → schedule;
   - LTR/RTL;
   - nonce CSP with no JavaScript `unsafe-inline`/`unsafe-eval` regressions.

6. **Generated API contract**
   - emit `contracts/openapi.json` from the exact final API tree;
   - regenerate `api-contract.generated.ts` with pinned `openapi-typescript@7.13.0`;
   - generated drift check;
   - dashboard typecheck;
   - self-clean one-shot workflow records its validated source SHA.

A failed surface is fixed on the integration branch and only the necessary failed work is rerun. No CI bypass.

## Post-merge production acceptance

Even a fully green PR is not the final 100%. After merge to `main`:

1. Publish immutable API/dashboard/maintenance GHCR images for the exact main SHA.
2. Configure production host read-only GHCR authentication and immutable registry prefix.
3. Run production preflight.
4. Take/verify the pre-migration backup.
5. Perform the blue/green deployment and health-gated traffic switch.
6. Pass public readiness + smoke checks.
7. Verify off-box backup/logging and private-only metrics scraping.
8. Exercise one-release traffic rollback and confirm service recovery.
9. Restore a current backup into a non-production target and run telemetry physical checks.
10. Build/sign/publish an Android candidate plus a **higher-version known-good recovery release**.
11. Roll out to a physical lab/canary screen and prove healthy heartbeat acceptance.
12. Deliberately exercise the OTA unhealthy-health-window path and prove automatic recovery to the pre-staged known-good release.
13. Complete final EN/AR production acceptance.

## Definition of 100% for this audit

**100% = implementation complete + final integrated validation green + production cutover/recovery accepted.**

Until those last two stages are complete, Wizer should be described as implementation-complete but not yet fully production-proven.
