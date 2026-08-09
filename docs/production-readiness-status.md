# Wizer Signage — Production Readiness Status

Last reconciled: 2026-08-09

This document tracks implementation of the production-readiness audit whose baseline was commit `7f256d6`. It is intentionally conservative: an item is marked complete only when the repository contains the implementation or a merged PR explicitly verifies it.

## Executive status

- **Ship blockers 1–19:** COMPLETE.
- **P0:** COMPLETE.
- **P1 application/security correctness:** COMPLETE.
- **P1 observability stack:** OPEN (Sentry/pino/Prometheus/off-box log shipping still require implementation/vendor configuration).
- **P1 immutable registry code path:** IMPLEMENTED IN PR #67; operational activation remains (publish a release, configure read-only GHCR auth on the production host, run the registry deploy + smoke gate).
- **P2:** PARTIAL. Several items are complete, but the large fleet/deployment/security items below remain open.

## Major work already merged

| Area | Status | Evidence |
|---|---|---|
| Original ship blockers | COMPLETE | PR #5 — retention batching, recovery/backup fixes, TLS reload, export/report boundaries, proof-of-play tenant boundary, timeouts, device-aware throttling, Android blackout/crash fixes, APK host fix, RESTRICT FKs, scanning |
| Remaining P0/P1 | COMPLETE | PR #22 — rollback/SHA tags, impersonation, request IDs, upload streaming, signed-URL cache, pagination, edge rate limiting, screen lifecycle, dashboard error/accessibility fixes, load-path work |
| CI/auth coverage | COMPLETE | PRs #34–#36 — real e2e wiring, auth matrix, guard/auth coverage, 2FA key-rotation recovery |
| 2FA re-authentication | COMPLETE | PR #61 |
| Post-deploy smoke gate | COMPLETE | PRs #31–#32 |
| Dependency security / Nest 11 | COMPLETE | PRs #29–#30 |
| Per-plan retention | COMPLETE | PR #38 |
| Manifest contract fixture | COMPLETE | PR #39 |
| URL-preview sandbox hardening | COMPLETE | PR #40 |
| Selector 100-row correctness cliff | COMPLETE for correctness; search UX still open | PR #41 loads all pages up to a visible 2,000-row ceiling |
| k6 + backup drills | COMPLETE | PR #42 nightly workflow |
| CSP baseline | PARTIAL | PR #43 adds non-breaking baseline directives; nonce-based `script-src` is still open |
| i18n catalogue splitting | COMPLETE | PR #44 |
| OpenAPI response contract | COMPLETE | PRs #45–#60, 209/209 operations |
| OpenAPI request-body contract | COMPLETE | PR #63, 72/72 operations |
| Proof-of-play monotonic/clamp | COMPLETE | PRs #22 and #37 |
| nginx keepalive/reload/dead config cleanup | COMPLETE | PRs #22, #37, #41 |

## Remaining production-readiness work

### 1. Android OTA + staged rollout — OPEN

The player still has no production OTA client consuming the published Android `latest.json`, no `PackageInstaller` flow, no percentage/group rollout, and no automatic rollback based on healthy heartbeats. This remains the largest fleet-MTTR risk because a bad player release can still require physical intervention.

Required completion criteria:

- Poll release metadata with jitter and timeout.
- Verify package name, signing certificate and SHA-256 before install.
- Support unattended install only on device-owner/MDM-capable devices; fail safely on ordinary devices.
- Server-side rollout targeting by screen/group/percentage with version pinning.
- Report version/install result/crash state in telemetry.
- Auto-halt or roll back a rollout when the new version misses its health window.
- Monotonic `versionCode` enforced by the release pipeline.

### 2. True zero-downtime deploys — OPEN/PARTIAL

PR #37 changed nginx restart to graceful reload and added a 60-second API drain window. That protects in-flight work, but Compose still recreates the single API/dashboard containers in place. There is no blue/green swap and no second healthy API replica carrying traffic during replacement.

Required completion criteria:

- Blue/green (or equivalent) service names with health-gated traffic switch.
- At least two API instances available across a rollout window.
- nginx upstream switched only after the new pool passes readiness.
- Old pool drained after the switch and retained long enough for immediate rollback.
- Deploy failure automatically keeps/returns traffic to the old pool.

### 3. Refresh token in httpOnly cookie + nonce CSP — OPEN/PARTIAL

The iframe `allow-same-origin` issue is fixed and the CSP has safe baseline directives. The refresh-token cookie migration is now being implemented in PR #69; nonce-backed `script-src` remains separate until that migration is green.

Required completion criteria:

- Refresh token only in `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/auth/refresh`.
- Access token stays short-lived/in memory or in the existing access-token store without a refresh bearer secret beside it.
- CSRF/origin handling verified for refresh/logout flows.
- Next middleware mints a per-request nonce and the rendered response uses it.
- CSP adds a real `script-src` without `'unsafe-inline'`.
- Browser tests prove EN/AR login and authenticated shell still hydrate under the policy.

### 4. Monthly partitioning for `heartbeats` and `proof_of_plays` — OPEN

The high-volume tables are indexed and retention is batched, but they are not partitioned. Retention therefore still performs row deletion rather than dropping old partitions.

Required completion criteria:

- Migration strategy that preserves existing data and foreign-key/query semantics.
- Monthly partitions with automatic creation ahead of time.
- Retention drops eligible partitions only after respecting per-plan retention windows.
- Prisma migrations remain reproducible from an empty Postgres 16 database with zero drift.
- Restore drills include partitioned data.

### 5. Selector scalability beyond the 2,000-row safety ceiling — PARTIAL

The silent 100-row truncation is fixed. The planned end state is still debounced server-side search/comboboxes instead of downloading up to 20 pages for every selector.

### 6. Dashboard types generated from OpenAPI — OPEN/PARTIAL

The OpenAPI contract is now complete and CI-pinned. The dashboard still needs to consume generated contract types instead of maintaining a parallel hand-written API model surface where applicable.

### 7. Playwright production smoke in English and Arabic/RTL — OPEN

Current smoke tests validate HTTP/edge behaviour and PR #44 used browser verification while developing the i18n split, but there is no committed Playwright journey covering login shell/navigation in both locales and asserting `dir="rtl"` for Arabic.

### 8. Android failure-path test depth — OPEN/PARTIAL

The player has substantial unit coverage and golden manifest tests, but the planned MockWebServer timeout/401/429/5xx/truncation cases, cache-corruption tests and broader Robolectric/Compose playback-loop coverage are not yet complete.

### 9. Observability substance — OPEN

External readiness monitoring and dead-man backup monitoring are in place, but the P1 observability implementation remains incomplete:

- Sentry for API and dashboard behind optional DSNs with scrubbing.
- Structured JSON logging (pino or equivalent) carrying requestId/companyId/userId.
- Internal-only Prometheus metrics endpoint and request/Prisma pool metrics.
- Off-box log shipping.
- Android crash/version fleet metrics surfaced in the dashboard.

### 10. Immutable registry release + production pull — CODE IMPLEMENTED, ACTIVATION OPEN

PR #67 adds the manual GHCR publisher, a fail-closed pull helper that verifies the embedded full Git revision before retagging, and `scripts/deploy-release.sh`. The new deploy path pulls the exact SHA release, takes the pre-migration backup, runs migrations from that image, starts Compose with `--no-build`, gates on readiness, smoke-tests the public endpoint, and writes the same history consumed by the existing rollback script.

Operational completion still requires:

1. Merge PR #67 after the normal CI matrix is green.
2. Run the manual release workflow once to publish the current main SHA.
3. Configure read-only GHCR authentication on the private production host and set `IMAGE_REGISTRY_PREFIX=ghcr.io/mohammedali-770`.
4. Run `scripts/deploy-release.sh` and confirm the public smoke gate.
5. Make the registry path the normal runbook once that first release is proven.

## Definition of production-ready for this audit

The audit is complete when every OPEN item above is either implemented and regression-tested, or deliberately removed from scope by an explicit product/operations decision recorded here. “Adjacent work exists” is not sufficient to mark an item complete.
