#!/usr/bin/env bash
# =============================================================================
# Regression tests for scripts/backup-db.sh + scripts/lib/pg-url.sh
# =============================================================================
# Deterministic and hermetic: NO real database, NO docker, NO network. pg_dump
# and node are replaced with mocks so we can assert exactly which URL the script
# hands to pg_dump and how failures are handled. Safe to run in CI.
#
# Covers (requirement C):
#   1. DIRECT_URL is selected when both URLs are set.
#   2. DATABASE_URL fallback works for a standard PostgreSQL URL.
#   3. A pooled URL with pgbouncer=true is never passed unchanged to pg_dump.
#   4. Missing usable URLs fail closed without leaking values.
#   5. pg_dump failure removes the partial output and records FAILED.
#   9. No credentials appear in the script's own logs.
# (Volume-ownership cases 6-8 need Docker and live in the e2e test.)
# =============================================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0
FAIL=0
SECRET="s3cretPWtoken"   # synthetic; must never appear in script output

pass() { PASS=$((PASS + 1)); echo "  ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; }

# Build a hermetic sandbox: copy the script + helper into a temp tree so the
# script's ROOT_DIR points at the sandbox (no repo-root .env is ever sourced),
# and put mock pg_dump/node first on PATH.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/scripts/lib" "$WORK/bin" "$WORK/backups"
cp "$REPO_ROOT/scripts/backup-db.sh" "$WORK/scripts/backup-db.sh"
cp "$REPO_ROOT/scripts/lib/pg-url.sh" "$WORK/scripts/lib/pg-url.sh"

cat > "$WORK/bin/pg_dump" <<'MOCK'
#!/usr/bin/env bash
# Capture the --dbname value the script chose, then emit a fake dump (or fail).
for a in "$@"; do
  case "$a" in --dbname=*) printf '%s' "${a#--dbname=}" > "$PG_DUMP_CAPTURE" ;; esac
done
if [ "${PG_DUMP_FAIL:-0}" = "1" ]; then
  echo "mock pg_dump: simulated failure" >&2
  exit 1
fi
printf -- '-- mock dump\n'
MOCK

cat > "$WORK/bin/node" <<'MOCK'
#!/usr/bin/env bash
# Mock the BackupRecord CLI: record the --status value only.
for a in "$@"; do
  case "$a" in --status=*) printf '%s\n' "${a#--status=}" >> "$RECORD_CAPTURE" ;; esac
done
exit 0
MOCK
chmod +x "$WORK/bin/pg_dump" "$WORK/bin/node"

# A stand-in CLI file so record_backup's `[[ -f "$cli" ]]` guard passes.
touch "$WORK/fake-cli.js"

# run_backup: runs the sandboxed script with the current DIRECT_URL/DATABASE_URL
# (which must be exported by the caller). Resets capture files each call and
# populates: RC, OUT (combined log), CAPTURED (dbname pg_dump saw), RECORD.
run_backup() {
  : > "$WORK/pg_dump_capture"; : > "$WORK/record_capture"; : > "$WORK/out.log"
  rm -f "$WORK/backups"/*.sql.gz 2>/dev/null || true
  PATH="$WORK/bin:$PATH" \
  BACKUP_DIR="$WORK/backups" \
  MAINTENANCE_CLI="$WORK/fake-cli.js" \
  PG_DUMP_CAPTURE="$WORK/pg_dump_capture" \
  RECORD_CAPTURE="$WORK/record_capture" \
  PG_DUMP_FAIL="${PG_DUMP_FAIL:-0}" \
    bash "$WORK/scripts/backup-db.sh" > "$WORK/out.log" 2>&1
  RC=$?
  CAPTURED="$(cat "$WORK/pg_dump_capture" 2>/dev/null || true)"
  RECORD="$(cat "$WORK/record_capture" 2>/dev/null || true)"
  OUT="$(cat "$WORK/out.log" 2>/dev/null || true)"
}

backup_count() { ls "$WORK"/backups/*.sql.gz 2>/dev/null | wc -l | tr -d ' '; }
reset_env() { unset DIRECT_URL DATABASE_URL PG_DUMP_FAIL; }

echo "== backup-db URL selection + failure handling =="

# --- 1. DIRECT_URL preferred when both are set -------------------------------
reset_env
export DIRECT_URL="postgresql://u:${SECRET}@direct.example:5432/app?sslmode=require"
export DATABASE_URL="postgresql://u:${SECRET}@pool.example:6543/app?pgbouncer=true&connection_limit=1"
run_backup
[ "$RC" -eq 0 ] && pass "1: backup succeeds with both URLs set" || fail "1: expected success (rc=$RC)"
[ "$CAPTURED" = "$DIRECT_URL" ] && pass "1: DIRECT_URL selected for pg_dump" || fail "1: wrong dbname (not DIRECT_URL)"
case "$CAPTURED" in *pgbouncer*) fail "1: pgbouncer leaked into dbname" ;; *) pass "1: no pgbouncer in dbname" ;; esac
[ "$(backup_count)" -eq 1 ] && pass "1: exactly one backup file written" || fail "1: backup file missing/duplicated"
echo "$RECORD" | grep -q "SUCCESS" && pass "1: BackupRecord SUCCESS recorded" || fail "1: SUCCESS not recorded"
case "$OUT" in *"$SECRET"*) fail "9: secret leaked in log (case 1)" ;; *) pass "9: no secret in log (case 1)" ;; esac

# --- 2. DATABASE_URL fallback for a standard PostgreSQL URL -------------------
reset_env
export DATABASE_URL="postgresql://u:${SECRET}@db.example:5432/app"
run_backup
[ "$RC" -eq 0 ] && pass "2: fallback backup succeeds" || fail "2: expected success (rc=$RC)"
[ "$CAPTURED" = "$DATABASE_URL" ] && pass "2: standard DATABASE_URL used unchanged" || fail "2: fallback dbname mismatch"

# --- 3. Pooled DATABASE_URL: pgbouncer stripped, other params kept -----------
reset_env
export DATABASE_URL="postgresql://u:${SECRET}@pool.example:6543/app?pgbouncer=true&sslmode=require"
run_backup
[ "$RC" -eq 0 ] && pass "3: pooled-fallback backup succeeds" || fail "3: expected success (rc=$RC)"
case "$CAPTURED" in *pgbouncer*) fail "3: pgbouncer NOT stripped" ;; *) pass "3: pgbouncer stripped from fallback" ;; esac
case "$CAPTURED" in *sslmode=require*) pass "3: sslmode preserved" ;; *) fail "3: sslmode dropped" ;; esac
case "$OUT" in *"$SECRET"*) fail "9: secret leaked in log (case 3)" ;; *) pass "9: no secret in log (case 3)" ;; esac

# --- 4. Neither URL set: fail closed, no leak --------------------------------
reset_env
run_backup
[ "$RC" -ne 0 ] && pass "4: fails closed when no URL set" || fail "4: did not fail closed"
{ echo "$OUT" | grep -q "DIRECT_URL" && echo "$OUT" | grep -q "DATABASE_URL"; } \
  && pass "4: error names both variables" || fail "4: error missing variable names"
[ "$(backup_count)" -eq 0 ] && pass "4: no backup file created" || fail "4: stray backup file"

# --- 5. pg_dump failure: partial removed + FAILED recorded -------------------
reset_env
export DIRECT_URL="postgresql://u:${SECRET}@direct.example:5432/app"
export PG_DUMP_FAIL=1
run_backup
[ "$RC" -ne 0 ] && pass "5: non-zero exit on pg_dump failure" || fail "5: masked pg_dump failure"
[ "$(backup_count)" -eq 0 ] && pass "5: partial output removed" || fail "5: partial file left behind"
echo "$RECORD" | grep -q "FAILED" && pass "5: BackupRecord FAILED recorded" || fail "5: FAILED not recorded"

# --- Defensive: DIRECT_URL itself carrying pgbouncer is still sanitized -------
reset_env
export DIRECT_URL="postgresql://u:${SECRET}@direct.example:5432/app?pgbouncer=true"
run_backup
case "$CAPTURED" in *pgbouncer*) fail "D: pgbouncer not stripped from DIRECT_URL" ;; *) pass "D: DIRECT_URL sanitized too" ;; esac

# --- F. Prisma `schema=` (used by the dev override) is stripped too ----------
reset_env
export DIRECT_URL="postgresql://u:${SECRET}@postgres:5432/app?schema=public&pgbouncer=true"
run_backup
case "$CAPTURED" in
  *schema=*|*pgbouncer*) fail "F: schema/pgbouncer not stripped (dev-override shape)" ;;
  *) pass "F: Prisma schema= and pgbouncer stripped for pg_dump" ;;
esac

reset_env
echo
echo "== results: ${PASS} passed, ${FAIL} failed =="
[ "$FAIL" -eq 0 ]
