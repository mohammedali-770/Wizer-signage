# Scripts (`scripts/`)

Operational shell scripts for Wizer Signage. All are POSIX `bash` and resolve
paths relative to the repo root so they can be run from anywhere. All use
`set -euo pipefail` except `smoke-test.sh`, which deliberately omits `-e`
(`set -uo pipefail`) so it can run every check and tally the failures instead of
stopping at the first one.

## Running on Windows

These are bash scripts. On Windows, run them from **Git Bash** or **WSL**:

```bash
bash scripts/dev.sh
```

The development and deploy flows also have direct `pnpm` / `docker compose`
equivalents you can run in PowerShell if you prefer (see each script's header).

## Scripts

### `dev.sh` — local development bootstrap

Copies `.env.example` to `.env` if missing, runs `pnpm install`, then starts
all apps in dev mode (`pnpm dev`).

```bash
bash scripts/dev.sh
```

### `deploy.sh` — production deploy (run on the host)

Pulls the latest code, builds the service images, brings the production compose
stack up, and polls `/api/health/ready` until the API is healthy. There is no
host-side dependency install — dependencies are installed inside the images, so
the host never needs pnpm or a Node toolchain.

```bash
bash scripts/deploy.sh
# Configurable via env: DEPLOY_BRANCH, HEALTH_URL, HEALTH_RETRIES, HEALTH_INTERVAL
```

### `backup-db.sh` — database backup

`pg_dump`s the database referenced by `DATABASE_URL` into a timestamped
`.sql.gz` under `backups/`, then prunes backups older than `RETENTION_DAYS`
(default 14). Reads `DATABASE_URL` from the environment or the repo-root
`.env`.

```bash
bash scripts/backup-db.sh
# Configurable via env: BACKUP_DIR, RETENTION_DAYS
```

Schedule it via cron, e.g. nightly at 02:30:

```cron
30 2 * * *  /opt/wizer-signage/scripts/backup-db.sh >> /var/log/ms-backup.log 2>&1
```

> Note: financial records have longer legal retention requirements than the
> routine 14-day window. Keep dedicated long-term/offsite copies. See
> `docs/backup-restore.md`.

### `restore-db.sh` — database restore (DESTRUCTIVE)

Restores a chosen `.sql.gz` dump into `DATABASE_URL`. Prompts for confirmation
(type `yes`) before overwriting data. Use `FORCE=1` to skip the prompt in
automation.

```bash
bash scripts/restore-db.sh backups/wizer-signage_20260614_023000.sql.gz
```

## Prerequisites

| Script          | Needs                                    |
| --------------- | ---------------------------------------- |
| `dev.sh`        | `pnpm`, Node >= 22.18.0                  |
| `deploy.sh`     | `git`, `docker` (compose plugin), `curl` |
| `backup-db.sh`  | `pg_dump` (postgresql-client), `gzip`    |
| `restore-db.sh` | `psql` (postgresql-client), `gunzip`     |

See also: `docs/local-development.md`, `docs/production-deployment.md`,
`docs/backup-restore.md`.
