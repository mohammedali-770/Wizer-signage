#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — backup/restore DRILL (Docker required)
# =============================================================================
# Proves the thing a backup exists for: that a dump produced by backup-db.sh can
# actually be RESTORED — including into a database that already has the schema,
# which is the real disaster-recovery and rollback case.
#
# This is the regression test for a genuine defect: pg_dump ran without
# --clean/--if-exists, so `restore-db.sh` piped the dump into
# `psql --set ON_ERROR_STOP=on` and the first CREATE TABLE aborted with
# "already exists". The backup was effectively write-only, and nobody would have
# discovered that until an outage.
#
# Everything it creates is namespaced `bkdrill_*` and removed on exit.
#
# Usage:  bash scripts/tests/backup-restore-drill.sh
# =============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v docker >/dev/null 2>&1 || { echo "docker not available — skipping" >&2; exit 2; }

PG=bkdrill_pg
WORK="$(mktemp -d)"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok   - $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; }
cleanup() {
  docker rm -f "$PG" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
cleanup

docker run -d --name "$PG" --network=host -e POSTGRES_PASSWORD=pw_drill postgres:16-alpine >/dev/null
for _ in $(seq 1 40); do
  docker exec "$PG" psql -U postgres -d postgres -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done

psql_q() { docker exec -i "$PG" psql -U postgres -d postgres -tAc "$1" 2>/dev/null; }

echo "== Seed a database that looks like production =="
docker exec -i "$PG" psql -U postgres -d postgres >/dev/null 2>&1 <<'SQL'
CREATE TABLE companies (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE invoices  (id text PRIMARY KEY, "companyId" text NOT NULL REFERENCES companies(id), total numeric NOT NULL);
INSERT INTO companies VALUES ('c1','Acme'), ('c2','Globex');
INSERT INTO invoices  VALUES ('i1','c1',100), ('i2','c1',250), ('i3','c2',75);
SQL
[ "$(psql_q 'select count(*) from invoices')" = "3" ] && ok "seeded 3 invoices" || no "seed failed"

echo "== Take a backup with the REAL backup-db.sh =="
mkdir -p "$WORK/backups"
OUT="$(docker run --rm --network=host -u "$(id -u)" \
  -v "$REPO/scripts:/app/scripts:ro" -v "$WORK/backups:/backups" \
  -e BACKUP_DIR=/backups \
  -e DIRECT_URL="postgresql://postgres:pw_drill@127.0.0.1:5432/postgres?sslmode=disable" \
  postgres:16-alpine bash /app/scripts/backup-db.sh 2>&1)"
RC=$?
[ "$RC" -eq 0 ] && ok "backup-db.sh succeeded" || { no "backup-db.sh rc=$RC"; echo "$OUT" | sed 's/^/      /'; }
DUMP="$(ls "$WORK"/backups/wizer-signage_*.sql.gz 2>/dev/null | head -1)"
[ -n "$DUMP" ] && ok "dump file written" || no "no dump produced"
case "$OUT" in *pw_drill*) no "credential leaked into backup log" ;; *) ok "no credential in backup log" ;; esac
# The offsite warning must be present when BACKUP_OFFSITE_CMD is unset.
case "$OUT" in *"BACKUP_OFFSITE_CMD is not set"*) ok "warns when no offsite copy is configured" ;; *) no "missing offsite warning" ;; esac

echo "== Mutate the database (simulate the damage we need to undo) =="
docker exec -i "$PG" psql -U postgres -d postgres -c "DELETE FROM invoices WHERE id='i2'; UPDATE companies SET name='CORRUPTED' WHERE id='c1';" >/dev/null 2>&1
[ "$(psql_q 'select count(*) from invoices')" = "2" ] && ok "database mutated (2 invoices, corrupted name)" || no "mutation failed"

echo "== Restore INTO THE NON-EMPTY database (the real DR case) =="
RES="$(docker run --rm --network=host \
  -v "$REPO/scripts:/app/scripts:ro" -v "$WORK/backups:/backups:ro" \
  -e FORCE=1 \
  -e DIRECT_URL="postgresql://postgres:pw_drill@127.0.0.1:5432/postgres?sslmode=disable" \
  postgres:16-alpine bash /app/scripts/restore-db.sh "/backups/$(basename "$DUMP")" 2>&1)"
RRC=$?
[ "$RRC" -eq 0 ] && ok "restore-db.sh succeeded against a populated database" || { no "restore rc=$RRC"; echo "$RES" | tail -5 | sed 's/^/      /'; }

echo "== Verify the data actually came back =="
[ "$(psql_q 'select count(*) from invoices')" = "3" ] && ok "all 3 invoices restored" || no "invoice count = $(psql_q 'select count(*) from invoices')"
[ "$(psql_q "select name from companies where id='c1'")" = "Acme" ] && ok "corrupted row restored to its backed-up value" || no "company name not restored"
[ "$(psql_q "select total from invoices where id='i2'")" = "250" ] && ok "deleted invoice restored with correct amount" || no "i2 not restored"
case "$RES" in *pw_drill*) no "credential leaked into restore log" ;; *) ok "no credential in restore log" ;; esac

echo
echo "== drill results: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
