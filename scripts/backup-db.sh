#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — Database backup
# =============================================================================
# Creates a compressed, timestamped logical backup (pg_dump) of the configured
# Postgres/Supabase database and prunes old backups.
#
# TARGET:
#   The production database is Supabase (managed Postgres). pg_dump is run
#   against DIRECT_URL when it is set (the non-pooled endpoint), falling back to
#   DATABASE_URL otherwise. The pooled Prisma DATABASE_URL carries
#   `pgbouncer=true`, which pg_dump rejects ("invalid URI query parameter:
#   pgbouncer"), so Prisma/PgBouncer-only query params are stripped before use
#   (see scripts/lib/pg-url.sh). Works against Supabase or any Postgres instance.
#
# SCHEDULING:
#   Intended to be run from cron, e.g. nightly at 02:30:
#       30 2 * * *  /opt/wizer-signage/scripts/backup-db.sh >> /var/log/ms-backup.log 2>&1
#
# RETENTION:
#   Routine backups are pruned after RETENTION_DAYS (default 14). NOTE: financial
#   records (invoices, payments, ledgers) are subject to longer legal retention
#   requirements and MUST be retained beyond this window. Do NOT rely on these
#   pruned snapshots for financial archival — keep dedicated long-term/offsite
#   copies (see docs/backup-restore.md).
#
# REQUIREMENTS:
#   - bash, pg_dump (postgresql-client), gzip
#   - DIRECT_URL (preferred) and/or DATABASE_URL set in the environment or in the
#     repo-root .env file. At least one must be present.
# =============================================================================

set -euo pipefail

# --- Resolve repo root relative to this script -------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Postgres URL selection/sanitization helpers (resolve_pg_dump_url).
# shellcheck source=scripts/lib/pg-url.sh
source "${SCRIPT_DIR}/lib/pg-url.sh"

# --- Load .env if present (without overriding already-exported vars) ---------
ENV_FILE="${ROOT_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
fi

# --- Configuration -----------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTFILE="${BACKUP_DIR}/wizer-signage_${TIMESTAMP}.sql.gz"

# --- Preconditions -----------------------------------------------------------
# Choose the URL pg_dump will use: DIRECT_URL when set, else a sanitized
# DATABASE_URL. Fails closed (secret-free) when neither is usable. Captured via
# command substitution so the URL never reaches the log; diagnostics (variable
# name only) from the helper go to stderr. The application DATABASE_URL is left
# untouched for the BackupRecord CLI below.
if ! DUMP_URL="$(resolve_pg_dump_url)"; then
  echo "ERROR: no usable database URL for pg_dump (set DIRECT_URL or DATABASE_URL in env or ${ENV_FILE})." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found. Install the postgresql-client package." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

# --- Record the run in the dashboard (best-effort) ---------------------------
# Writes a BackupRecord so Super Admins see backup health (Phase 10). Requires
# the API to be built (apps/api/dist) and DATABASE_URL in the env. A FAILED
# record raises a system "backup overdue/failed" alert.
record_backup() {
  local status="$1" location="${2:-}" size="${3:-}" error="${4:-}"
  # MAINTENANCE_CLI overrides the path (the maintenance container ships the CLI
  # at /app/dist/maintenance/maintenance.cli.js, not under apps/api).
  local cli="${MAINTENANCE_CLI:-${ROOT_DIR}/apps/api/dist/maintenance/maintenance.cli.js}"
  if command -v node >/dev/null 2>&1 && [[ -f "${cli}" ]]; then
    node "${cli}" record-backup \
      --type=DATABASE --status="${status}" \
      --location="${location}" --size="${size}" --error="${error}" >/dev/null 2>&1 || true
  fi
}

# --- Run the dump ------------------------------------------------------------
echo "[backup] Starting backup -> ${OUTFILE}"
echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --no-owner / --no-privileges keep the dump portable across roles (useful when
# restoring into Supabase or a fresh local instance).
#
# --clean --if-exists is REQUIRED for the dump to be restorable into a database
# that already has the schema — which is exactly the disaster-recovery and
# rollback case this file exists for. Without it, restore-db.sh pipes the dump
# into `psql --set ON_ERROR_STOP=on` and the very first CREATE TABLE aborts with
# "already exists", so the backup was effectively write-only.
#
# Wizer owns TWO PostgreSQL schemas after telemetry partitioning:
#   public          — Prisma-owned business tables + partition parents
#   wizer_telemetry — monthly child partitions + PoP idempotency registry
#
# Both must be in the same logical dump. Omitting wizer_telemetry creates a
# deceptively successful backup that restores parent tables but loses telemetry
# rows and cross-partition idempotency state. Keeping public explicitly avoids
# Supabase-owned auth/storage/extension schemas that Wizer neither owns nor has
# permission to recreate. Before the partition migration exists in a database,
# public is still selected and remains the complete Wizer-owned schema.
if pg_dump \
    --dbname="${DUMP_URL}" \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    --schema=public \
    --schema=wizer_telemetry \
    --format=plain \
    | gzip -9 > "${OUTFILE}"; then
  SIZE="$(du -h "${OUTFILE}" | cut -f1)"
  SIZE_BYTES="$(wc -c < "${OUTFILE}" | tr -d ' ')"
  echo "[backup] OK — wrote ${OUTFILE} (${SIZE})"

  # --- Offsite copy --------------------------------------------------------
  # A backup that only exists on the machine it backs up is not a backup: losing
  # the droplet (or one `docker compose down -v`) destroys the application AND
  # every recovery point in the same event. Copy offsite BEFORE the prune below,
  # and treat an upload failure as a FAILED run so the "backup overdue" alert
  # fires rather than silently leaving the only copy on the box.
  #
  # BACKUP_OFFSITE_CMD receives the dump path as $1, e.g.
  #   BACKUP_OFFSITE_CMD='rclone copyto "$1" "remote:wizer-backups/$(basename "$1")"'
  #
  # The command runs inside the MAINTENANCE CONTAINER on the nightly schedule
  # (infra/docker/crontab) and on the HOST at deploy time (deploy-blue-green.sh).
  # Anything it names must exist in both. Dockerfile.maintenance installs rclone
  # for exactly this reason; do not assume aws/curl/scp are available.
  if [[ -n "${BACKUP_OFFSITE_CMD:-}" ]]; then
    echo "[backup] Copying offsite..."
    if sh -c "${BACKUP_OFFSITE_CMD}" _ "${OUTFILE}"; then
      echo "[backup] Offsite copy OK."
    else
      echo "[backup] FAILED — offsite copy failed; the only copy is on this host." >&2
      record_backup "FAILED" "${OUTFILE}" "${SIZE_BYTES}" "offsite copy failed"
      exit 1
    fi

    # --- Verify the copy actually landed -----------------------------------
    # A zero exit from the copy command is NOT evidence that any bytes arrived.
    # Observed for real: busybox `wget --post-file` truncates a gzip dump at the
    # first NUL byte — a 942-byte backup became a 3-byte remote object — and
    # still exited 0. Without this check the run reports "Offsite copy OK",
    # pings the dead-man switch and prunes older backups, so the operator is
    # told everything is healthy while the off-box copy is a stub. That failure
    # is silent, cumulative, and only discovered during a restore.
    #
    # BACKUP_OFFSITE_VERIFY_CMD receives the same dump path as $1 and must print
    # the size of the REMOTE object in bytes as the first token of stdout, e.g.
    #   BACKUP_OFFSITE_VERIFY_CMD='rclone size --json "remote:wizer-backups/$(basename "$1")" | sed -n "s/.*\"bytes\":\([0-9]*\).*/\1/p"'
    # The size is compared against the local dump, so the check does not depend
    # on the verifying tool's own success claim.
    if [[ -n "${BACKUP_OFFSITE_VERIFY_CMD:-}" ]]; then
      echo "[backup] Verifying the offsite copy..."
      if ! VERIFY_OUT="$(sh -c "${BACKUP_OFFSITE_VERIFY_CMD}" _ "${OUTFILE}")"; then
        echo "[backup] FAILED — offsite verification command failed; the copy is unproven." >&2
        record_backup "FAILED" "${OUTFILE}" "${SIZE_BYTES}" "offsite verification failed"
        exit 1
      fi
      # First whitespace-separated token only: a bare integer is required, so a
      # command that prints a path, an error or nothing fails closed instead of
      # having digits scraped out of unrelated output.
      REMOTE_BYTES="${VERIFY_OUT%%[[:space:]]*}"
      if [[ ! "${REMOTE_BYTES}" =~ ^[0-9]+$ ]]; then
        echo "[backup] FAILED — offsite verification did not report a byte count." >&2
        record_backup "FAILED" "${OUTFILE}" "${SIZE_BYTES}" "offsite verification returned no byte count"
        exit 1
      fi
      if [[ "${REMOTE_BYTES}" != "${SIZE_BYTES}" ]]; then
        echo "[backup] FAILED — offsite copy is ${REMOTE_BYTES} byte(s); the local dump is ${SIZE_BYTES}." >&2
        record_backup "FAILED" "${OUTFILE}" "${SIZE_BYTES}" "offsite copy size mismatch"
        exit 1
      fi
      echo "[backup] Offsite copy verified — ${REMOTE_BYTES} bytes match the local dump."
    else
      echo "[backup] WARNING: BACKUP_OFFSITE_VERIFY_CMD is not set — the offsite copy is" >&2
      echo "[backup]          assumed from an exit status, not confirmed. A command that" >&2
      echo "[backup]          silently transfers nothing will still report success." >&2
    fi
  else
    echo "[backup] WARNING: BACKUP_OFFSITE_CMD is not set — this backup exists ONLY on this host." >&2
    echo "[backup]          Losing this machine loses the database and every snapshot with it." >&2
  fi

  record_backup "SUCCESS" "${OUTFILE}" "${SIZE_BYTES}" ""
else
  echo "[backup] FAILED — removing partial file ${OUTFILE}" >&2
  rm -f "${OUTFILE}"
  record_backup "FAILED" "" "" "pg_dump failed"
  exit 1
fi

# --- Prune old backups -------------------------------------------------------
echo "[backup] Pruning backups older than ${RETENTION_DAYS} day(s)..."
PRUNED="$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'wizer-signage_*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete | wc -l | tr -d ' ')"
echo "[backup] Pruned ${PRUNED} old backup(s)."

echo "[backup] Done."
