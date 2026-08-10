# Release Validation — 2026-08-10

This file records the final repository-level production-readiness validation pass for PR #80 (`codex/production-readiness-final` → `main`).

## Repaired release blockers

- Clean-runner OpenAPI generation now builds required workspace dependencies before emitting the contract.
- Generated dashboard API contract drift checking is deterministic under the repository Prettier configuration.
- Super Admin invoice selector integration syntax is repaired.
- Schedule target selector label tuple narrowing is type-safe.
- Playwright launches the real production Next.js server on its configured port.
- Strict CSP passes the request nonce to the `next-themes` bootstrap script.
- EN/AR Playwright production journey covers login, authenticated shell, screen creation, multipart content upload, schedule creation and schedule-detail rendering.
- Exact Gitleaks test-fixture false positives are documented without broad allowlisting.
- CI uses a dedicated empty Prisma shadow database for strict migration drift validation.
- Prisma telemetry models now match the intentional PostgreSQL partition design:
  - `Heartbeat` physical primary key: `(id, createdAt)`.
  - `ProofOfPlay` physical primary key: `(id, startedAt)`.
  - `ProofOfPlay` retains the non-unique `(companyId, playbackSessionId)` lookup index created by the partition migration.
  - Cross-partition proof-of-play session idempotency remains PostgreSQL registry/trigger-owned rather than an impossible direct partition-parent unique constraint.
- OpenAPI response completeness recognizes documented `202 Accepted` asynchronous operations instead of treating them as undocumented.
- The integrated request-body operation denominator is pinned to the current complete contract rather than the pre-observability count.
- The integrated OpenAPI tag inventory is pinned to the current 32-tag contract so a missing controller tag still fails closed.
- Fleet-health Swagger response types have one canonical class declaration; compatibility imports re-export that canonical surface.
- The 24-character Android crash fingerprint documented in Swagger is enforced on both ingestion and the canonical fleet-health DTO contract.
- Telemetry partition static tests validate model blocks independently of Prisma model ordering and verify the composed top-level/isolation verifier contract without false positives from explanatory comment text.
- Android release and production-deploy static invariants now test the current fail-closed implementation without relying on obsolete comment text or `exec` handoff behavior.

## Release policy

No CI bypass is permitted. PR #80 remains the single integration vehicle and may merge only when the exact final head passes the full automated release matrix. Live production cutover and physical Android TV acceptance remain separate operational gates tracked by the production-readiness issue.
