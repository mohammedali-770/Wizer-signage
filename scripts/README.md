# Scripts (`scripts/`)

Operational shell scripts for MasterSignage. All scripts are POSIX `bash`,
use `set -euo pipefail`, and resolve paths relative to the repo root so they
can be run from anywhere.

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

Pulls the latest code, installs dependencies with a frozen lockfile, builds the
service images, brings the production compose stack up, and polls
`/api/health` until the API is healthy.

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
30 2 * * *  /opt/master-signage/scripts/backup-db.sh >> /var/log/ms-backup.log 2>&1
```

> Note: financial records have longer legal retention requirements than the
> routine 14-day window. Keep dedicated long-term/offsite copies. See
> `docs/backup-restore.md`.

### `restore-db.sh` — database restore (DESTRUCTIVE)

Restores a chosen `.sql.gz` dump into `DATABASE_URL`. Prompts for confirmation
(type `yes`) before overwriting data. Use `FORCE=1` to skip the prompt in
automation.

```bash
bash scripts/restore-db.sh backups/master-signage_20260614_023000.sql.gz
```

## Prerequisites

| Script          | Needs                                            |
| --------------- | ------------------------------------------------ |
| `dev.sh`        | `pnpm`, Node >= 20                               |
| `deploy.sh`     | `git`, `pnpm`, `docker` (compose plugin), `curl` |
| `backup-db.sh`  | `pg_dump` (postgresql-client), `gzip`            |
| `restore-db.sh` | `psql` (postgresql-client), `gunzip`             |

See also: `docs/local-development.md`, `docs/production-deployment.md`,
`docs/backup-restore.md`.
