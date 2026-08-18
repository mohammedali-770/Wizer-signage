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

# --- Restore into a fresh namespace, then swap -------------------------------
# The dump is NOT applied on top of the live schema. The Wizer-owned schemas are
# renamed aside first, the dump is restored into the names it has just freed, and
# the archived copies are only dropped once the restore has succeeded.
#
# Why this is not optional, and why it is a rename rather than a drop:
#
# Applying the dump over an existing migrated schema does not work at all. Since
# telemetry partitioning, `pg_dump --clean --if-exists` emits
#   ALTER TABLE IF EXISTS ONLY <child> DROP CONSTRAINT IF EXISTS <child>_pkey;
# for every monthly child partition. A partition's primary key is INHERITED from
# its parent, and PostgreSQL refuses to drop an inherited constraint directly:
#   ERROR: cannot drop inherited constraint "..._pkey" of relation "..."
# `IF EXISTS` does not help — the constraint exists, it just cannot be dropped on
# its own. This is the same class of defect as the original missing --clean: the
# backup restored into an empty database and nowhere else, so it was effectively
# write-only for the disaster-recovery case it exists for.
#
# The failure was also destructive. `ON_ERROR_STOP=on` aborts partway through
# pg_dump's preamble, and by then every foreign key in the database has already
# been dropped — leaving the target neither intact nor restored. Renaming instead
# of dropping means the original schemas are still whole under an archive name if
# anything goes wrong, so a failed restore is recoverable.
#
# A fresh DATABASE would be the more usual form of this, but production is
# managed Postgres (Supabase): the connection owns one database it cannot rename
# and cannot disconnect the platform's own sessions from. Schema rename needs
# only ownership, so it works on both managed and self-hosted targets.
ARCHIVE_SUFFIX="$(date -u +%Y%m%d_%H%M%S)"
ARCHIVE_PUBLIC="wizer_pre_restore_${ARCHIVE_SUFFIX}_public"
ARCHIVE_TELEMETRY="wizer_pre_restore_${ARCHIVE_SUFFIX}_telemetry"

psql_do() {
  psql --dbname="${RESTORE_URL}" -X -qAt --set ON_ERROR_STOP=on -c "$1"
}

# Both renames in ONE transaction: a half-renamed database is not a state any
# later step here knows how to reason about.
echo "[restore] Archiving the current schemas before touching anything..."
if ! psql_do "BEGIN;
  DO \$\$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public') THEN
      EXECUTE format('ALTER SCHEMA public RENAME TO %I', '${ARCHIVE_PUBLIC}');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'wizer_telemetry') THEN
      EXECUTE format('ALTER SCHEMA wizer_telemetry RENAME TO %I', '${ARCHIVE_TELEMETRY}');
    END IF;
  END \$\$;
COMMIT;" >/dev/null; then
  echo "[restore] FAILED — could not archive the existing schemas; nothing was changed." >&2
  exit 1
fi
echo "[restore] Archived to ${ARCHIVE_PUBLIC} / ${ARCHIVE_TELEMETRY} (kept until the restore succeeds)."

# Put the database back exactly as it was. Used for every failure below, so a
# failed restore leaves the operator with a working database rather than wreckage.
rollback_swap() {
  echo "[restore] Rolling back to the archived schemas..." >&2
  psql --dbname="${RESTORE_URL}" -X -qAt -c "BEGIN;
    DROP SCHEMA IF EXISTS public CASCADE;
    DROP SCHEMA IF EXISTS wizer_telemetry CASCADE;
    DO \$\$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '${ARCHIVE_PUBLIC}') THEN
        EXECUTE format('ALTER SCHEMA %I RENAME TO public', '${ARCHIVE_PUBLIC}');
      END IF;
      IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '${ARCHIVE_TELEMETRY}') THEN
        EXECUTE format('ALTER SCHEMA %I RENAME TO wizer_telemetry', '${ARCHIVE_TELEMETRY}');
      END IF;
    END \$\$;
  COMMIT;" >/dev/null 2>&1 \
    && echo "[restore] Rolled back — the database is as it was before this run." >&2 \
    || echo "[restore] ROLLBACK FAILED — original data is still in ${ARCHIVE_PUBLIC} / ${ARCHIVE_TELEMETRY}." >&2
}

echo "[restore] Starting restore from ${DUMP_FILE}"
echo "[restore] $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Stop on the first SQL error so a bad restore fails loudly.
if ! gunzip -c "${DUMP_FILE}" | psql --dbname="${RESTORE_URL}" --set ON_ERROR_STOP=on; then
  echo "[restore] FAILED — see errors above." >&2
  rollback_swap
  exit 1
fi

# A restore that exits 0 having created nothing is the failure mode this whole
# file exists to make impossible, so confirm the schemas are actually populated
# before the archive is eligible to be dropped.
RESTORED_TABLES="$(psql_do "SELECT count(*) FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','wizer_telemetry')" || echo 0)"
if [[ ! "${RESTORED_TABLES}" =~ ^[0-9]+$ ]] || (( RESTORED_TABLES < 1 )); then
  echo "[restore] FAILED — restore reported success but no tables are present." >&2
  rollback_swap
  exit 1
fi
echo "[restore] OK — restore completed (${RESTORED_TABLES} tables across both Wizer schemas)."

# The archive is retained by default. It is the only remaining copy of whatever
# the database held before this ran, and dropping it automatically would remove
# the operator's last chance to compare against it.
if [[ "${RESTORE_DROP_ARCHIVE:-0}" == "1" ]]; then
  psql_do "DROP SCHEMA IF EXISTS \"${ARCHIVE_PUBLIC}\" CASCADE;
           DROP SCHEMA IF EXISTS \"${ARCHIVE_TELEMETRY}\" CASCADE;" >/dev/null \
    && echo "[restore] Dropped the pre-restore archive (RESTORE_DROP_ARCHIVE=1)." \
    || echo "[restore] WARNING: could not drop the pre-restore archive." >&2
else
  echo "[restore] Pre-restore copy retained as ${ARCHIVE_PUBLIC} / ${ARCHIVE_TELEMETRY}."
  echo "[restore] Drop it once you are satisfied:"
  echo "[restore]   DROP SCHEMA \"${ARCHIVE_PUBLIC}\" CASCADE; DROP SCHEMA \"${ARCHIVE_TELEMETRY}\" CASCADE;"
fi

echo "[restore] Done."
