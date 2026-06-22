# Future External API & Webhooks

This document describes the **external developer API** and **webhook** capabilities that
MasterSignage is **designed for in v1** and will **fully build out later**. The internal
API (consumed by the dashboard and the Android TV player) already exists under the global
`/api` prefix; this page is about the _public-facing, per-company integration surface_.

> **Status:** Foundation / design intent for Phase 0–1. The models, prefixes and event
> names below are the contract future work will implement against. Nothing here implies the
> features are complete today.

---

## 1. Goals

- Let each **company (tenant)** integrate MasterSignage with their own systems via
  authenticated, rate-limited API keys.
- Push real-time **webhook** notifications for significant signage events.
- Provide stable **versioning** and self-serve **documentation**.
- Keep everything **multi-tenant safe** — keys and webhooks are always scoped to one company
  and can never read or affect another tenant's data. See [multi-tenancy.md](./multi-tenancy.md)
  and [security.md](./security.md).

---

## 2. Per-company API keys

Each company will be able to create and manage one or more API keys.

**Capabilities (planned):**

- **Permissions / scopes** — keys are restricted to specific actions/resources (e.g.
  read-only screen status vs. content management). Least-privilege by default.
- **Enable / disable** — a key can be toggled off instantly without deletion (and rotated).
- **Rate limits** — per-key request quotas (e.g. requests/minute and/or daily caps) to
  protect the platform; limits surfaced via standard `RateLimit-*` response headers and
  `429` on exhaustion.
- **Usage audit logs** — every key, when used, records request metadata (timestamp, route,
  status, IP, key id) for security review and troubleshooting.

**Conceptual model — `ApiKey`:**

| Field                     | Description                                                       |
| ------------------------- | ----------------------------------------------------------------- |
| `id`                      | Identifier.                                                       |
| `companyId`               | Owning tenant (scopes everything the key can touch).              |
| `name`                    | Human label.                                                      |
| `prefix`                  | Non-secret, displayable key prefix for identification.            |
| `hashedSecret`            | Hash of the secret (the plaintext is shown **once** at creation). |
| `scopes`                  | Granted permissions.                                              |
| `rateLimit`               | Per-key quota configuration.                                      |
| `enabled`                 | Active/inactive toggle.                                           |
| `lastUsedAt`              | Last successful use.                                              |
| `expiresAt`               | Optional expiry.                                                  |
| `createdBy` / `createdAt` | Provenance.                                                       |

Authentication will use a bearer/API-key header; secrets are stored **hashed** and never
returned after creation.

---

## 3. Versioning & documentation strategy

- **Versioning:** the public API will be explicitly versioned (URL-prefixed, e.g.
  `/api/v1/...`) so breaking changes ship under a new version while older versions remain
  supported through a published deprecation window.
- **Documentation:** OpenAPI/Swagger generated from the NestJS controllers and served at
  **`/api/docs`** (Swagger UI), with a downloadable OpenAPI JSON for client/SDK generation.
- **Changelog & deprecations:** documented alongside the spec so integrators can plan
  upgrades.

---

## 4. Webhooks

Webhooks let a company receive **outbound HTTP callbacks** when events occur, instead of
polling the API.

### 4.1 Event catalog (planned)

| Event                       | Fires when                                       |
| --------------------------- | ------------------------------------------------ |
| `screen.offline`            | A screen/player loses connectivity.              |
| `screen.online`             | A previously offline screen reconnects.          |
| `content.played`            | A piece of content finishes playing on a screen. |
| `sync.failed`               | A content/playlist sync to a device fails.       |
| `emergency.broadcast.start` | An emergency broadcast begins.                   |
| `emergency.broadcast.end`   | An emergency broadcast ends.                     |
| `screenshot.captured`       | A device screenshot is captured.                 |
| `subscription.expiring`     | A company's subscription nears expiry.           |
| `storage.warning`           | Storage usage crosses a warning threshold.       |

> This list is the v1 foundation; additional events will be added under the same model.

### 4.2 Conceptual model — `Webhook`

| Field                     | Description                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `id`                      | Identifier.                                                                          |
| `companyId`               | Owning tenant.                                                                       |
| `url`                     | Destination URL to POST event payloads to.                                           |
| `secret`                  | Signing secret; each delivery is signed (HMAC) so receivers can verify authenticity. |
| `eventFilters`            | The subset of events this endpoint subscribes to.                                    |
| `retryAttempts`           | Max delivery retries on failure (with backoff).                                      |
| `enabled`                 | Active/inactive toggle.                                                              |
| `createdAt` / `updatedAt` | Timestamps.                                                                          |

### 4.3 Delivery & reliability

- **Signed payloads:** each request carries an HMAC signature derived from the webhook
  `secret`, plus a timestamp, so receivers can verify integrity and reject replays.
- **Retries:** failed deliveries (non-2xx / timeout) are retried up to `retryAttempts` with
  exponential backoff.
- **Delivery logs:** every attempt is recorded — event, endpoint, response status, duration,
  attempt number — and is viewable by the company for debugging.

**Conceptual model — `WebhookDelivery`:**

| Field            | Description                           |
| ---------------- | ------------------------------------- |
| `id`             | Identifier.                           |
| `webhookId`      | Source webhook.                       |
| `event`          | Event name from the catalog.          |
| `payload`        | JSON body sent.                       |
| `responseStatus` | HTTP status returned by the receiver. |
| `attempt`        | Attempt number.                       |
| `success`        | Whether the delivery succeeded.       |
| `createdAt`      | Attempt timestamp.                    |

---

## 5. Integration with backup alerting

The webhook foundation is also used internally for operational alerts such as
**backup-failure notifications** described in [backup-restore.md](./backup-restore.md).

---

## 6. Out of scope for now

- Public SDK packages, OAuth client-credentials flows, and partner marketplace listings are
  future work. The data models and `/api/docs` surface above are the foundation those will
  build on.

---

## Related documentation

- [architecture.md](./architecture.md) — where the API sits in the system
- [multi-tenancy.md](./multi-tenancy.md) — tenant scoping of keys and webhooks
- [security.md](./security.md) — secret handling, signing, auditing
- [backup-restore.md](./backup-restore.md) — backup-failure webhook alerts
- [roadmap.md](./roadmap.md) — when this is scheduled to be built
