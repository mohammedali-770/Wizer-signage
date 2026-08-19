# Environment Variables Reference

This document is the canonical reference for every environment variable used across the
**Wizer Signage** platform. The variable **names and spellings listed here are
contractual** — application code, Docker Compose files, Nginx, and the root
`.env.example` all use these exact identifiers. Do not rename them.

## How configuration is loaded

- A single root **`.env`** file holds the values for local development. Copy it from the
  committed template: `cp .env.example .env`, then fill in the blanks.
- In production the same variables are supplied through the server's `.env` file (read by
  Docker Compose) or injected by the orchestrator / secret manager. See
  [production-deployment.md](./production-deployment.md).
- The API (NestJS) and Dashboard (Next.js) each read only the subset of variables relevant
  to them (see the **Scope** column).

> **Security:** `.env` is git-ignored and **must never be committed**. Only `.env.example`
> (with placeholder values, no real secrets) is tracked. Rotate any secret that is
> accidentally committed. See [security.md](./security.md) for the full policy.

### Public vs. secret variables

- Variables prefixed with **`NEXT_PUBLIC_`** are inlined into the browser bundle at build
  time by Next.js and are therefore **public** — never put a secret behind that prefix.
- Everything else is server-side only. Service-role keys, JWT secrets, SMTP passwords and
  database URLs are **secrets** and must be stored only in untracked `.env` files or a
  secret manager.

---

## App

Core process configuration shared by the API and Dashboard.

| Variable             | Required | Scope  | Description                                                                                                                                                                                                 | Example / Placeholder                  |
| -------------------- | -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `NODE_ENV`           | Yes      | shared | Runtime mode. Controls optimizations, logging verbosity and error detail.                                                                                                                                   | `development` / `production`           |
| `LOG_LEVEL`          | No       | shared | Minimum log severity emitted by the structured logger.                                                                                                                                                      | `info` (`debug`/`info`/`warn`/`error`) |
| `PERF_LOG_REQUESTS`  | No       | api    | `true` logs every request (method/path/status/ms + company/user id). Off by default; slow requests warn regardless. Never logs bodies/headers/tokens. See [performance-tuning.md](./performance-tuning.md). | `false`                                |
| `PERF_SLOW_MS`       | No       | api    | Request duration (ms) that triggers a SLOW warning.                                                                                                                                                         | `1000`                                 |
| `PERF_LOG_QUERIES`   | No       | api    | `true` logs Prisma SQL + duration (NEVER the bound params/values).                                                                                                                                          | `false`                                |
| `PERF_SLOW_QUERY_MS` | No       | api    | Query duration (ms) tagged SLOW in query logs.                                                                                                                                                              | `50`                                   |

---

## Networking / URLs

Ports and base URLs that wire the services together and configure CORS / WebSockets.

| Variable              | Required | Scope           | Description                                                                                                                                                                                                              | Example / Placeholder                    |
| --------------------- | -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `API_HOST`            | No       | api             | Bind address for the API. Defaults to `0.0.0.0` so nginx can proxy to it across the Docker network; binding `127.0.0.1` inside a container causes 502s.                                                                  | `0.0.0.0`                                |
| `API_PORT`            | Yes      | api             | Port the NestJS API listens on. Routes are served under the global `/api` prefix.                                                                                                                                        | `3001`                                   |
| `DASHBOARD_PORT`      | Yes      | dashboard       | Port the Next.js dashboard listens on.                                                                                                                                                                                   | `3000`                                   |
| `API_URL`             | Yes      | dashboard/infra | Server-to-server base URL of the API (used by the dashboard's server components and by Nginx).                                                                                                                           | `http://api:3001`                        |
| `NEXT_PUBLIC_API_URL` | Yes      | dashboard       | **Public.** Browser-facing base URL of the API, inlined into the client bundle at build time. **Required for a production build** — must be absolute HTTPS (no localhost/credentials/query/fragment) or the build fails. | `https://wizer.sa/api`                   |
| `CORS_ORIGINS`        | Yes      | api             | Comma-separated allowed browser origins for CORS. **Required in production** — HTTPS origins only (no path); `*`, localhost, or malformed values fail API boot. Dev: unset ⇒ reflect any origin.                         | `http://localhost:3000,https://wizer.sa` |
| `APP_URL`             | No       | api             | Dashboard base URL used to build links in transactional emails (invitations, password reset).                                                                                                                            | `https://wizer.sa`                       |
| `DASHBOARD_URL`       | No       | api             | Accepted **fallback** for `APP_URL` when it is not set.                                                                                                                                                                  | `https://wizer.sa`                       |

> `NEXT_PUBLIC_API_URL` is **public**; `API_URL` is the internal address used inside the
> Docker network and is not exposed to the browser.

---

## Database / Supabase

The platform's database and object storage are provided by **Supabase (external)**. In
production there is **no local database** — these point at the managed Supabase project.
For offline development an optional local Postgres can be started (see
[local-development.md](./local-development.md)).

| Variable                    | Required     | Scope | Description                                                                                                                      | Example / Placeholder                                                              |
| --------------------------- | ------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`              | **REQUIRED** | api   | Pooled Postgres connection string (e.g. PgBouncer / Supabase pooler) used by the application. **Enforced at boot from Phase 1.** | `postgresql://postgres:password@db.<ref>.supabase.co:6543/postgres?pgbouncer=true` |
| `DIRECT_URL`                | Yes          | api   | Direct (non-pooled) Postgres connection used for migrations and admin tasks.                                                     | `postgresql://postgres:password@db.<ref>.supabase.co:5432/postgres`                |
| `SUPABASE_URL`              | Yes          | api   | Base URL of the Supabase project (REST / Auth / Storage endpoints).                                                              | `https://<ref>.supabase.co`                                                        |
| `SUPABASE_ANON_KEY`         | Yes          | api   | Public anon API key. Safe for limited client use but kept server-side in this architecture.                                      | `eyJhbGciOiJIUzI1NiIsInR5cCI6...`                                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes          | api   | **Secret.** Full-access service-role key. Server-only — never expose to the browser.                                             | `eyJhbGciOiJIUzI1NiIsInR5cCI6...`                                                  |
| `SUPABASE_STORAGE_BUCKET`   | Yes          | api   | Name of the Supabase Storage bucket holding uploaded media/content.                                                              | `media`                                                                            |

> See [database-schema.md](./database-schema.md) for the data model and
> [backup-restore.md](./backup-restore.md) for backup/restore of these stores.

---

## Auth / JWT / Session

Secrets and lifetimes for authentication tokens and inactivity handling. **All JWT
secrets are sensitive.** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `ENCRYPTION_KEY`
are **enforced at boot from Phase 1** (secrets must be ≥16 chars). See
[security.md](./security.md).

| Variable                             | Required     | Scope | Description                                                                                | Example / Placeholder                |
| ------------------------------------ | ------------ | ----- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| `JWT_ACCESS_SECRET`                  | **REQUIRED** | api   | **Secret.** Signing key for short-lived access tokens. ≥16 chars, long random value.       | `change-me-32+char-random-string`    |
| `JWT_REFRESH_SECRET`                 | **REQUIRED** | api   | **Secret.** Signing key for refresh tokens. ≥16 chars; must differ from the access secret. | `change-me-different-32+char-random` |
| `ENCRYPTION_KEY`                     | **REQUIRED** | api   | **Secret.** Encrypts 2FA TOTP secrets at rest. ≥16 chars, long random value.               | `change-me-32+char-random-string`    |
| `JWT_ACCESS_TTL`                     | Yes          | api   | Access-token lifetime (seconds, or a duration string the auth layer accepts).              | `900` (15m)                          |
| `JWT_REFRESH_TTL`                    | Yes          | api   | Refresh-token lifetime.                                                                    | `1209600` (14d)                      |
| `SESSION_INACTIVITY_TIMEOUT_MINUTES` | Yes          | api   | Minutes of inactivity after which an authenticated session is invalidated.                 | `30`                                 |
| `TWO_FACTOR_ISSUER`                  | No           | api   | Issuer label shown in authenticator apps for 2FA enrollment.                               | `Wizer Signage` (default)            |

---

## Seed

Optional values consumed by the `db:seed` script. When the password defaults are used,
the seed prints a warning. They are not read at runtime.

| Variable                     | Required | Scope | Description                                        | Example / Placeholder    |
| ---------------------------- | -------- | ----- | -------------------------------------------------- | ------------------------ |
| `SEED_SUPERADMIN_EMAIL`      | No       | api   | Email for the seeded Super Admin account.          | `superadmin@wizer.local` |
| `SEED_SUPERADMIN_PASSWORD`   | No       | api   | **Secret.** Password for the seeded Super Admin.   | `change-me`              |
| `SEED_SUPERADMIN_NAME`       | No       | api   | Display name for the seeded Super Admin.           | `Super Admin`            |
| `SEED_COMPANY_NAME`          | No       | api   | Name of the seeded demo company.                   | `Demo Company`           |
| `SEED_COMPANYADMIN_PASSWORD` | No       | api   | **Secret.** Password for the seeded Company Admin. | `change-me`              |

---

## Email / SMTP

Outbound transactional email (invitations, alerts, password resets). The SMTP password is
a **secret**.

| Variable        | Required | Scope | Description                                                    | Example / Placeholder               |
| --------------- | -------- | ----- | -------------------------------------------------------------- | ----------------------------------- |
| `SMTP_HOST`     | Yes      | api   | SMTP server hostname.                                          | `smtp.example.com`                  |
| `SMTP_PORT`     | Yes      | api   | SMTP server port (`587` for STARTTLS, `465` for implicit TLS). | `587`                               |
| `SMTP_USER`     | Yes      | api   | SMTP authentication username.                                  | `no-reply@wizer.sa`                 |
| `SMTP_PASSWORD` | Yes      | api   | **Secret.** SMTP authentication password / app password.       | `change-me`                         |
| `SMTP_PASS`     | No       | api   | **Secret.** Alias for `SMTP_PASSWORD` (either is accepted).    | `change-me`                         |
| `SMTP_FROM`     | Yes      | api   | Default From address for outgoing mail.                        | `Wizer Signage <no-reply@wizer.sa>` |
| `SMTP_SECURE`   | No       | api   | Force implicit TLS on connect. Defaults to true for port 465.  | `false`                             |

> When SMTP is **unset**, the API logs emails instead of sending them (dev mode);
> every send is recorded in `EmailDeliveryLog` either way.

---

## Maintenance & retention (Phase 10/11)

Drive the maintenance worker / cron jobs and data retention.

| Variable                       | Required | Scope     | Description                                                                                                  | Example |
| ------------------------------ | -------- | --------- | ------------------------------------------------------------------------------------------------------------ | ------- |
| `RETENTION_DAYS`               | No       | api/maint | Retention window (days) for telemetry/operational data. **Financial records are never deleted.** Default 90. | `90`    |
| `CONTENT_TRASH_RETENTION_DAYS` | No       | api/maint | Days before trashed content is purged. Default 14.                                                           | `14`    |
| `TZ`                           | No       | maint     | Timezone for the maintenance cron schedule. Default UTC.                                                     | `UTC`   |
| `SWAGGER_ENABLED`              | No       | api       | Force-enable Swagger UI in production (default disabled).                                                    | `false` |

---

## Backups (Phase 11)

| Variable                    | Required   | Scope      | Description                                                                                                                                                                                                                                                       | Example                                                                                          |
| --------------------------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `BACKUP_DIR`                | No         | maint      | `pg_dump` output directory (the worker mounts a volume at `/backups`).                                                                                                                                                                                            | `/backups`                                                                                       |
| `BACKUP_RETENTION_DAYS`     | No         | maint      | Prune `*.sql.gz` snapshots after N days (defaults to `RETENTION_DAYS`). **Does not** delete DB financial records.                                                                                                                                                 | `14`                                                                                             |
| `BACKUP_OFFSITE_CMD`        | Yes (prod) | maint/host | Copies the dump OFF this host; receives the path as `$1`. Runs both on the host at deploy time and inside the maintenance container nightly, so it must resolve in **both** — only `rclone` is installed in that image.                                           | `rclone copyto "$1" "remote:wizer/$(basename "$1")"`                                             |
| `BACKUP_OFFSITE_VERIFY_CMD` | Yes (prod) | maint/host | Confirms the copy landed. Receives the path as `$1` and must print the **remote** size in bytes as the first stdout token; `backup-db.sh` compares it to the local dump and fails on mismatch. A zero exit from the copy alone is not evidence any bytes arrived. | `rclone size --json "remote:wizer/$(basename "$1")" \| sed -n "s/.*\"bytes\":\([0-9]*\).*/\1/p"` |
| `MAINTENANCE_CLI`           | No         | maint      | Path to the maintenance CLI the backup script calls to record runs (set inside the worker image).                                                                                                                                                                 | `/app/dist/maintenance/maintenance.cli.js`                                                       |
| `HEALTHCHECKS_URL`          | No (rec.)  | maint      | Dead-man's-switch pinged **only after a successful backup** (e.g. healthchecks.io). The in-app "backup overdue" alert is raised by the same container that runs the backup, so it cannot report its own death — this is the out-of-band signal.                   | `https://hc-ping.com/<uuid>`                                                                     |

---

## Deployment / proxy (Phase 11)

| Variable                | Required   | Scope        | Description                                                                                                                                     | Example            |
| ----------------------- | ---------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `APP_DOMAIN`            | Yes (prod) | nginx, maint | Public domain for nginx `server_name` + TLS cert paths; also used by the nightly TLS expiry check.                                              | `signage.wizer.sa` |
| `NGINX_ENVSUBST_FILTER` | No         | nginx        | Required only when using the nginx template: `^APP_DOMAIN$`.                                                                                    | `^APP_DOMAIN$`     |
| `LETSENCRYPT_EMAIL`     | No         | certbot      | Contact email for Let's Encrypt issuance/expiry notices.                                                                                        | `ops@wizer.sa`     |
| `CERT_WARN_DAYS`        | No         | maint        | Alert when the **served** certificate has fewer than N days left. Default 21.                                                                   | `21`               |
| `NGINX_RELOAD_INTERVAL` | No         | nginx        | Seconds between periodic `nginx -s reload` so a renewed certificate is actually served (nginx loads certs at startup only). Default 21600 (6h). | `21600`            |

> **TLS renewal is a two-part mechanism.** certbot renews the files; nginx only
> serves a renewed certificate after a reload. The certbot override runs a
> `--deploy-hook` (marker + log line) and the nginx container reloads on
> `NGINX_RELOAD_INTERVAL`, bounding "renewed but not served" to one interval.
> `scripts/check-cert-expiry.sh` (nightly, via the maintenance crontab) verifies
> the certificate the endpoint **actually serves**, so it catches both halves.

> `NEXT_PUBLIC_API_URL` is **build-time** for the dashboard image (compose
> `build.args`) — it is inlined into the browser bundle, so changing it requires
> rebuilding the dashboard image.

---

## Map

Configuration for the map provider used to display screen/site locations.

| Variable       | Required | Scope         | Description                                                                                                                             | Example / Placeholder |
| -------------- | -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `MAP_PROVIDER` | No       | api/dashboard | Selected map provider identifier.                                                                                                       | `google` / `mapbox`   |
| `MAP_API_KEY`  | No       | api/dashboard | **Secret-ish.** API key for the chosen map provider. If exposed to the browser, restrict it by referrer/origin in the provider console. | `change-me`           |

---

## Redis

Optional cache / queue / pub-sub backend (used for sessions, rate-limiting and realtime
fan-out as the platform grows).

| Variable    | Required | Scope | Description              | Example / Placeholder    |
| ----------- | -------- | ----- | ------------------------ | ------------------------ |
| `REDIS_URL` | No       | api   | Redis connection string. | `redis://localhost:6379` |

---

## Quick checklist

Before starting the stack, confirm the following are set (the rest have safe defaults):

- App: `NODE_ENV`
- Networking: `API_PORT`, `DASHBOARD_PORT`, `API_URL`, `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS`
- Database/Supabase: `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`
- Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` (all enforced at boot, ≥16 chars), `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `SESSION_INACTIVITY_TIMEOUT_MINUTES`
- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`
- Maintenance/backup (prod): `RETENTION_DAYS`, `CONTENT_TRASH_RETENTION_DAYS`, `BACKUP_DIR`, `BACKUP_OFFSITE_CMD`, `BACKUP_OFFSITE_VERIFY_CMD`, `TZ`
- Deployment (prod): `APP_DOMAIN`, `LETSENCRYPT_EMAIL`, and the dashboard build arg `NEXT_PUBLIC_API_URL`

The canonical production template is [`infra/docker/.env.production.example`](../infra/docker/.env.production.example).

## Related documentation

- [local-development.md](./local-development.md) — filling `.env` for local work
- [production-deployment.md](./production-deployment.md) — production values & secret handling
- [docker-production.md](./docker-production.md) — build args vs runtime env
- [security-hardening.md](./security-hardening.md) — secret management and rotation policy
- [architecture.md](./architecture.md) — how services consume these variables
