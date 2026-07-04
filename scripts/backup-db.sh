#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — Database backup
# =============================================================================
# Creates a compressed, timestamped logical backup (pg_dump) of the configured
# Postgres/Supabase database and prunes old backups.
#
# TARGET:
#   The production database is Supabase (managed Postgres). This script uses
#   DATABASE_URL, so it works against Supabase or any other Postgres instance.
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
#   - DATABASE_URL set in the environment or in the repo-root .env file.
# =============================================================================

set -euo pipefail

# --- Resolve repo root relative to this script -------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

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
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set (env or ${ENV_FILE})." >&2
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
if pg_dump \
    --dbname="${DATABASE_URL}" \
    --no-owner \
    --no-privileges \
    --format=plain \
    | gzip -9 > "${OUTFILE}"; then
  SIZE="$(du -h "${OUTFILE}" | cut -f1)"
  SIZE_BYTES="$(wc -c < "${OUTFILE}" | tr -d ' ')"
  echo "[backup] OK — wrote ${OUTFILE} (${SIZE})"
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
