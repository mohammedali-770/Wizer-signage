#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — Database restore
# =============================================================================
# Restores a compressed logical backup (.sql.gz produced by backup-db.sh) into
# the target database. Like backup-db.sh, psql runs against DIRECT_URL when set
# (the non-pooled endpoint), else a sanitized DATABASE_URL — a pooled Prisma URL
# with `pgbouncer=true` is never handed to psql unchanged (see scripts/lib/pg-url.sh).
#
# !! DESTRUCTIVE !!
#   Restoring overwrites data in the target database. This script requires an
#   explicit confirmation before proceeding.
#
# USAGE:
#   scripts/restore-db.sh <path-to-dump.sql.gz>
#
# Example:
#   scripts/restore-db.sh backups/wizer-signage_20260614_023000.sql.gz
#
# Bypass the interactive prompt (e.g. in automation) with:
#   FORCE=1 scripts/restore-db.sh <dump>
#
# REQUIREMENTS:
#   - bash, psql (postgresql-client), gunzip
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
# Choose the URL psql restores into: DIRECT_URL when set, else a sanitized
# DATABASE_URL. Fails closed (secret-free) when neither is usable.
if ! RESTORE_URL="$(resolve_pg_dump_url)"; then
  echo "ERROR: no usable database URL for psql (set DIRECT_URL or DATABASE_URL in env or ${ENV_FILE})." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found. Install the postgresql-client package." >&2
  exit 1
fi

# Redact credentials when echoing the target for the confirmation prompt.
DB_TARGET="$(echo "${RESTORE_URL}" | sed -E 's#(://[^:/@]+):[^@]*@#\1:****@#')"

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
if gunzip -c "${DUMP_FILE}" | psql --dbname="${RESTORE_URL}" --set ON_ERROR_STOP=on; then
  echo "[restore] OK — restore completed."
else
  echo "[restore] FAILED — see errors above." >&2
  exit 1
fi

echo "[restore] Done."
