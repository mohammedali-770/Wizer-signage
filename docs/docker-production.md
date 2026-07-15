# Docker Production Stack (Phase 11)

Wizer Signage ships as a small set of containers behind Nginx. Database and
object storage are **external (Supabase)** — there is no database container in
production.

## Services

| Service       | Image                                 | Port            | Notes                                              |
| ------------- | ------------------------------------- | --------------- | -------------------------------------------------- |
| `api`         | `apps/api/Dockerfile`                 | 3001 (internal) | NestJS; multi-stage, non-root `node`               |
| `dashboard`   | `apps/dashboard/Dockerfile`           | 3000 (internal) | Next.js standalone, non-root `nextjs`              |
| `maintenance` | `infra/docker/Dockerfile.maintenance` | —               | busybox crond → Phase 10 maintenance CLI + backups |
| `nginx`       | `nginx:1.27-alpine`                   | 80/443 (public) | reverse proxy + TLS                                |

Compose files (`infra/docker/`):

- `docker-compose.yml` — the **production** stack (the file above).
- `docker-compose.dev.yml` — local override adding a `postgres:16` container (dev only).
- `docker-compose.certbot.yml` — optional containerized Let's Encrypt.

## Image design

All images are **multi-stage** and run as a **non-root** user, with **no secrets
baked in** (config comes from env at runtime; the only build arg is the public,
non-secret `NEXT_PUBLIC_API_URL`). Healthchecks hit `/api/health` (api), `/`
(dashboard), and `pgrep crond` (maintenance).

- **API:** `pnpm install --filter @wizer/api...` → `prisma generate`
  runs via the build → `nest build` → `pnpm deploy --prod` prunes dev deps. The
  runtime carries `dist/` + a lean `node_modules` (incl. the Prisma client). The
  Prisma schema + migrations ship so you can run `prisma migrate deploy` inside
  the container.
- **Dashboard:** built with `NEXT_OUTPUT=standalone`; `NEXT_PUBLIC_API_URL` is
  inlined at **build time** — set it via the compose `build.args` to your public
  API origin (`https://$APP_DOMAIN/api`). It is **not** a secret.
- **Maintenance:** reuses the API build, adds `su-exec` (jobs drop to `node`),
  `bash`, and `postgresql-client` (`pg_dump`), and runs `crond` against
  `infra/docker/crontab`.

## Build & run

```bash
# From the repo root. Put your filled-in env in ./.env (see
# infra/docker/.env.production.example).

# Build all images (dashboard NEXT_PUBLIC_API_URL comes from .env):
docker compose --env-file .env -f infra/docker/docker-compose.yml build

# Apply database migrations (run once per deploy, BEFORE starting — see runbook):
docker compose --env-file .env -f infra/docker/docker-compose.yml run --rm \
  -e NODE_ENV=production api npx prisma migrate deploy

# Start the stack:
docker compose --env-file .env -f infra/docker/docker-compose.yml up -d

# Verify:
docker compose --env-file .env -f infra/docker/docker-compose.yml ps
curl -fsS https://$APP_DOMAIN/api/health
docker compose --env-file .env -f infra/docker/docker-compose.yml logs -f maintenance
```

> The dashboard's `NEXT_PUBLIC_API_URL` is **build-time**. If you change your
> domain, **rebuild** the dashboard image (`docker compose build dashboard`).

## Resource limits & logging

Each service sets `deploy.resources.limits` (api 1.5cpu/768M, dashboard
1.0cpu/512M, maintenance 0.5cpu/384M) and `json-file` logging with
`max-size=10m, max-file=5` (log rotation built in). Tune for your VPS.

## Volumes

- `wizer-signage-backups` — `pg_dump` output written by the maintenance worker.
- `wizer-signage-letsencrypt` / `wizer-signage-certbot-webroot` — TLS certs +
  ACME challenge (shared with nginx/certbot).

## Local development with a Postgres container

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.dev.yml up -d
```

This adds a `postgres:16` service for offline dev only — **never** in production.

See also: [production-deployment.md](./production-deployment.md) (full runbook),
[nginx-ssl.md](./nginx-ssl.md), [environment-variables.md](./environment-variables.md),
[security-hardening.md](./security-hardening.md).
