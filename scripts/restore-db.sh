#!/usr/bin/env bash
# =============================================================================
# MasterSignage — Database restore
# =============================================================================
# Restores a compressed logical backup (.sql.gz produced by backup-db.sh) into
# the database referenced by DATABASE_URL.
#
# !! DESTRUCTIVE !!
#   Restoring overwrites data in the target database. This script requires an
#   explicit confirmation before proceeding.
#
# USAGE:
#   scripts/restore-db.sh <path-to-dump.sql.gz>
#
# Example:
#   scripts/restore-db.sh backups/master-signage_20260614_023000.sql.gz
#
# Bypass the interactive prompt (e.g. in automation) with:
#   FORCE=1 scripts/restore-db.sh <dump>
#
# REQUIREMENTS:
#   - bash, psql (postgresql-client), gunzip
#   - DATABASE_URL set in the environment or in the repo-root .env file.
# =============================================================================

set -euo pipefail

# --- Resolve repo root relative to this script -------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat >&2 <<'EOF'
Usage: restore-db.sh <path-to-dump.sql.gz>

Restores a .sql.gz backup into the database referenced by DATABASE_URL.
This is DESTRUCTIVE and will overwrite existing data.

Options (env):
  FORCE=1   Skip the interactive confirmation prompt.
EOF
  exit 1
}

# --- Arguments ---------------------------------------------------------------
DUMP_FILE="${1:-}"
if [[ -z "${DUMP_FILE}" ]]; then
  echo "ERROR: no dump file provided." >&2
  usage
fi

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "ERROR: dump file not found: ${DUMP_FILE}" >&2
  exit 1
fi

# --- Load .env if present ----------------------------------------------------
ENV_FILE="${ROOT_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
fi

# --- Preconditions -----------------------------------------------------------
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set (env or ${ENV_FILE})." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found. Install the postgresql-client package." >&2
  exit 1
fi

# Redact credentials when echoing the target for the confirmation prompt.
DB_TARGET="$(echo "${DATABASE_URL}" | sed -E 's#(://[^:/@]+):[^@]*@#\1:****@#')"

# --- Confirmation guard ------------------------------------------------------
echo "About to RESTORE:"
echo "    dump   : ${DUMP_FILE}"
echo "    target : ${DB_TARGET}"
echo ""
echo "This will OVERWRITE data in the target database."

if [[ "${FORCE:-0}" != "1" ]]; then
  read -r -p "Type 'yes' to continue: " CONFIRM
  if [[ "${CONFIRM}" != "yes" ]]; then
    echo "[restore] Aborted by user."
    exit 1
  fi
fi

# --- Run the restore ---------------------------------------------------------
echo "[restore] Starting restore from ${DUMP_FILE}"
echo "[restore] $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Stop on the first SQL error so a bad restore fails loudly.
if gunzip -c "${DUMP_FILE}" | psql --dbname="${DATABASE_URL}" --set ON_ERROR_STOP=on; then
  echo "[restore] OK — restore completed."
else
  echo "[restore] FAILED — see errors above." >&2
  exit 1
fi

echo "[restore] Done."
