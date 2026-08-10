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
  - Cross-partition proof-of-play session idempotency remains PostgreSQL registry/trigger-owned rather than an impossible direct partition-parent unique constraint.

## Release policy

No CI bypass is permitted. PR #80 remains the single integration vehicle and may merge only when the exact final head passes the full automated release matrix. Live production cutover and physical Android TV acceptance remain separate operational gates tracked by the production-readiness issue.
