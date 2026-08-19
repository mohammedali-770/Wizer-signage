#!/usr/bin/env bash
# =============================================================================
# Regression tests for scripts/backup-db.sh + scripts/lib/pg-url.sh
# =============================================================================
# Deterministic and hermetic: NO real database, NO docker, NO network. pg_dump
# and node are replaced with mocks so we can assert exactly which URL and schema
# boundaries the script hands to pg_dump and how failures are handled.
#
# Covers (requirement C):
#   1. DIRECT_URL is selected when both URLs are set.
#   2. DATABASE_URL fallback works for a standard PostgreSQL URL.
#   3. A pooled URL with pgbouncer=true is never passed unchanged to pg_dump.
#   4. Missing usable URLs fail closed without leaking values.
#   5. pg_dump failure removes the partial output and records FAILED.
#   6. Both Wizer-owned schemas (public + wizer_telemetry) are always selected.
#   9. No credentials appear in the script's own logs.
#   H. The offsite copy is CONFIRMED, not assumed from an exit status: a command
#      that exits 0 having transferred a truncated file must fail the run.
# (Volume-ownership cases 7-8 need Docker and live in the e2e test.)
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
# Capture every argument plus the --dbname value, then emit a fake dump (or fail).
printf '%s\n' "$@" > "$PG_DUMP_ARGS_CAPTURE"
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
# populates: RC, OUT (combined log), CAPTURED (dbname pg_dump saw), ARGS (all
# pg_dump arguments), RECORD.
run_backup() {
  : > "$WORK/pg_dump_capture"; : > "$WORK/pg_dump_args_capture"; : > "$WORK/record_capture"; : > "$WORK/out.log"
  rm -f "$WORK/backups"/*.sql.gz 2>/dev/null || true
  PATH="$WORK/bin:$PATH" \
  BACKUP_DIR="$WORK/backups" \
  MAINTENANCE_CLI="$WORK/fake-cli.js" \
  PG_DUMP_CAPTURE="$WORK/pg_dump_capture" \
  PG_DUMP_ARGS_CAPTURE="$WORK/pg_dump_args_capture" \
  RECORD_CAPTURE="$WORK/record_capture" \
  PG_DUMP_FAIL="${PG_DUMP_FAIL:-0}" \
    bash "$WORK/scripts/backup-db.sh" > "$WORK/out.log" 2>&1
  RC=$?
  CAPTURED="$(cat "$WORK/pg_dump_capture" 2>/dev/null || true)"
  ARGS="$(cat "$WORK/pg_dump_args_capture" 2>/dev/null || true)"
  RECORD="$(cat "$WORK/record_capture" 2>/dev/null || true)"
  OUT="$(cat "$WORK/out.log" 2>/dev/null || true)"
}

backup_count() { ls "$WORK"/backups/*.sql.gz 2>/dev/null | wc -l | tr -d ' '; }
reset_env() { unset DIRECT_URL DATABASE_URL PG_DUMP_FAIL BACKUP_OFFSITE_CMD BACKUP_OFFSITE_VERIFY_CMD; }

# A real directory standing in for the offsite destination, so these cases move
# actual bytes rather than asserting against a mock's say-so.
REMOTE="$WORK/remote"; mkdir -p "$REMOTE"
reset_remote() { rm -f "$REMOTE"/* 2>/dev/null || true; }
remote_size() { wc -c < "$REMOTE/$(ls "$REMOTE" 2>/dev/null | head -1)" 2>/dev/null | tr -d ' '; }
pruned()  { case "$OUT" in *"Pruning backups older than"*) return 0 ;; *) return 1 ;; esac; }

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

echo "$ARGS" | grep -Fxq -- '--schema=public' \
  && pass "6: public schema included" || fail "6: public schema missing from pg_dump"
echo "$ARGS" | grep -Fxq -- '--schema=wizer_telemetry' \
  && pass "6: wizer_telemetry schema included" || fail "6: wizer_telemetry schema missing from pg_dump"
[ "$(printf '%s\n' "$ARGS" | grep -c '^--schema=')" -eq 2 ] \
  && pass "6: exactly the two Wizer-owned schemas selected" || fail "6: unexpected pg_dump schema selection"

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

# --- G. A URI fragment must not stay glued to a kept parameter ----------------
reset_env
export DIRECT_URL="postgresql://u:${SECRET}@h:5432/app?sslmode=require#frag"
run_backup
case "$CAPTURED" in
  *'#'*) fail "G: fragment leaked into pg_dump dbname" ;;
  *) pass "G: URI fragment dropped from pg_dump dbname" ;;
esac
case "$CAPTURED" in *sslmode=require) pass "G: sslmode value intact after fragment strip" ;; *) fail "G: sslmode value corrupted" ;; esac


echo
echo "== offsite copy is confirmed, not assumed =="

# H1. THE REGRESSION. A copy command that exits 0 having written only the first
# three bytes -- exactly what busybox `wget --post-file` does to a gzip dump,
# which begins 1f 8b 08 00 -- must fail the run. Before the verify step this
# logged "Offsite copy OK", recorded SUCCESS, pinged the dead-man and pruned.
reset_env; reset_remote
export DIRECT_URL="postgresql://u:${SECRET}@direct.example:5432/app"
export BACKUP_OFFSITE_CMD='head -c 3 "$1" > "'"$REMOTE"'/$(basename "$1")"'
export BACKUP_OFFSITE_VERIFY_CMD='wc -c < "'"$REMOTE"'/$(basename "$1")" | tr -d " "'
run_backup
[ "$RC" -ne 0 ] && pass "H1: truncated offsite copy fails the run" || fail "H1: truncated copy reported success (rc=$RC)"
echo "$RECORD" | grep -q "FAILED" && pass "H1: BackupRecord FAILED recorded" || fail "H1: FAILED not recorded"
case "$OUT" in *"Offsite copy OK"*) pass "H1: the copy command itself did exit 0" ;; *) fail "H1: precondition lost -- copy did not exit 0" ;; esac
[ "$(remote_size)" = "3" ] && pass "H1: only 3 bytes actually landed offsite" || fail "H1: expected a 3-byte remote object, got $(remote_size)"
pruned && fail "H1: pruned local backups despite an unproven offsite copy" || pass "H1: no prune after offsite verification failure"

# H2. An honest copy verifies and the run completes.
reset_env; reset_remote
export DIRECT_URL="postgresql://u:${SECRET}@direct.example:5432/app"
export BACKUP_OFFSITE_CMD='cp "$1" "'"$REMOTE"'/$(basename "$1")"'
export BACKUP_OFFSITE_VERIFY_CMD='wc -c < "'"$REMOTE"'/$(basename "$1")" | tr -d " "'
run_backup
[ "$RC" -eq 0 ] && pass "H2: complete offsite copy succeeds" || fail "H2: expected success (rc=$RC)"
echo "$OUT" | grep -q "Offsite copy verified" && pass "H2: verification is logged" || fail "H2: verification not logged"
echo "$RECORD" | grep -q "SUCCESS" && pass "H2: BackupRecord SUCCESS recorded" || fail "H2: SUCCESS not recorded"
pruned && pass "H2: prune runs once the copy is proven" || fail "H2: prune skipped on a good run"
case "$OUT" in *"$SECRET"*) fail "9: secret leaked in log (case H2)" ;; *) pass "9: no secret in log (case H2)" ;; esac

# H3. A verify command that cannot answer must not be read as success.
reset_env; reset_remote
export DIRECT_URL="postgresql://u:${SECRET}@direct.example:5432/app"
export BACKUP_OFFSITE_CMD='cp "$1" "'"$REMOTE"'/$(basename "$1")"'
export BACKUP_OFFSITE_VERIFY_CMD='exit 7'
run_backup
[ "$RC" -ne 0 ] && pass "H3: failing verification command fails the run" || fail "H3: verification failure masked"
pruned && fail "H3: pruned despite failed verification" || pass "H3: no prune after a failed verification command"

# H4. Output that is not a byte count fails closed rather than being scraped.
reset_env; reset_remote
export DIRECT_URL="postgresql://u:${SECRET}@direct.example:5432/app"
export BACKUP_OFFSITE_CMD='cp "$1" "'"$REMOTE"'/$(basename "$1")"'
export BACKUP_OFFSITE_VERIFY_CMD='echo "upload complete"'
run_backup
[ "$RC" -ne 0 ] && pass "H4: non-numeric verification output fails closed" || fail "H4: accepted a non-numeric size"
echo "$OUT" | grep -q "did not report a byte count" && pass "H4: reason names the missing byte count" || fail "H4: unclear reason"

# H5. Offsite configured without verification still runs, but says so loudly.
reset_env; reset_remote
export DIRECT_URL="postgresql://u:${SECRET}@direct.example:5432/app"
export BACKUP_OFFSITE_CMD='cp "$1" "'"$REMOTE"'/$(basename "$1")"'
run_backup
[ "$RC" -eq 0 ] && pass "H5: unverified offsite copy still completes" || fail "H5: expected success (rc=$RC)"
echo "$OUT" | grep -q "BACKUP_OFFSITE_VERIFY_CMD is not set" && pass "H5: warns that the copy is unconfirmed" || fail "H5: missing unverified-copy warning"

# H6. A copy command that fails outright fails the run and keeps the local dump.
reset_env; reset_remote
export DIRECT_URL="postgresql://u:${SECRET}@direct.example:5432/app"
export BACKUP_OFFSITE_CMD='exit 127'
run_backup
[ "$RC" -ne 0 ] && pass "H6: failed offsite copy fails the run" || fail "H6: offsite failure masked"
[ "$(backup_count)" -eq 1 ] && pass "H6: local dump retained as the only copy" || fail "H6: local dump lost after offsite failure"
pruned && fail "H6: pruned after a failed offsite copy" || pass "H6: no prune after a failed offsite copy"

reset_env
echo
echo "== results: ${PASS} passed, ${FAIL} failed =="
[ "$FAIL" -eq 0 ]
