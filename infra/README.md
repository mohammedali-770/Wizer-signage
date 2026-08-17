# Infrastructure (`infra/`)

This directory contains the deployment infrastructure for **Wizer Signage** —
the Docker Compose stacks, the Nginx reverse proxy configuration, and a
convenience `Makefile`.

## Layout

```
infra/
  docker/
    docker-compose.yml       # Production base stack (api, dashboard, maintenance, nginx)
    docker-compose.dev.yml   # OPTIONAL dev override (adds local postgres)
  nginx/
    nginx.conf               # Main nginx config
    templates/
      wizer-signage.conf.template  # Server blocks (${APP_DOMAIN}, rendered at startup)
    README.md                # Cert workflow & nginx operations
  Makefile                   # up / down / logs / build / backup / restore ...
  README.md                  # (this file)
```

## Services

| Service     | Image / Build                     | Internal port | Exposed  |
| ----------- | --------------------------------- | ------------- | -------- |
| `api`       | build `apps/api/Dockerfile`       | 3001          | internal |
| `dashboard` | build `apps/dashboard/Dockerfile` | 3000          | internal |
| `nginx`     | `nginx:1.27-alpine`               | 80 / 443      | 80, 443  |
| `postgres`  | `postgres:16-alpine` (dev only)   | 5432          | 5432     |

## Production vs. development

**Production** uses **Supabase** (managed Postgres + object storage) as the
database and storage layer. There is **no local database container** in
production — connectivity is configured entirely through env vars
(`SUPABASE_URL`, `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_STORAGE_BUCKET`, ...). See `docs/environment-variables.md`.

**Development** may optionally layer in `docker-compose.dev.yml`, which adds a
local `postgres:16` container for offline work. This is a convenience only —
Supabase remains the real target, and Supabase-specific features (RLS, storage,
auth) are **not** reproduced locally.

## Common commands

All commands are run from the **repo root**.

```bash
# Start the production stack (detached)
docker compose --env-file .env -f infra/docker/docker-compose.yml up -d

# Start with the dev override (adds local postgres)
docker compose \
  -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.dev.yml up -d

# Tail logs
docker compose --env-file .env -f infra/docker/docker-compose.yml logs -f

# Stop and remove containers
docker compose --env-file .env -f infra/docker/docker-compose.yml down
```

The `Makefile` in this directory wraps these commands (`make up`, `make down`,
`make logs`, `make dev-up`, `make build`, `make backup`, ...). On Windows
without `make`, run the `docker compose` commands directly.

## Environment

All services load configuration from the **repo-root `.env`** file. Copy
`.env.example` to `.env` and fill in the values before bringing the stack up.

## Further reading

- `docs/production-deployment.md` — full production deployment guide.
- `docs/backup-restore.md` — backup & restore procedures (see also
  `scripts/backup-db.sh` and `scripts/restore-db.sh`).
- `docs/environment-variables.md` — every environment variable explained.
- `infra/nginx/README.md` — TLS certificate workflow and nginx operations.
