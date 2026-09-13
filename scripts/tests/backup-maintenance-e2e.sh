#!/usr/bin/env bash
# =============================================================================
# End-to-end test for the maintenance backup fix (Docker required).
# =============================================================================
# OPT-IN / MANUAL: this test needs a working Docker daemon and pulls
# node:20-alpine + postgres:17-alpine. It is NOT run in CI (CI runs the
# deterministic, mock-based scripts/tests/backup-db.test.sh instead). Every
# container/volume/network it creates is namespaced `bke2e_*` and removed on exit.
#
# Proves (requirement C, cases that need a real container/volume):
#   6. A fresh root-owned /backups volume is made writable by node (uid 1000)
#      by the entrypoint before cron starts.
#   7. The backup runs as the unprivileged node user, not root.
#   8. Existing backup files survive a container restart/re-init (idempotent).
#   + a REAL pg_dump backup that prefers DIRECT_URL, strips pgbouncer, and never
#     leaks credentials, plus a reproduction of the original production error.
#
# Usage:  bash scripts/tests/backup-maintenance-e2e.sh
# =============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENTRY="$REPO/infra/docker/maintenance-entrypoint.sh"
[ -f "$REPO/scripts/backup-db.sh" ] || { echo "cannot locate repo root" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "docker not available — skipping e2e" >&2; exit 2; }

NET=bke2e_net; VOL=bke2e_backups; PG=bke2e_pg; OWN=bke2e_own
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  ok   - $1"; }
no(){ FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
cleanup(){ docker rm -f "$PG" "$OWN" >/dev/null 2>&1 || true
           docker volume rm "$VOL" >/dev/null 2>&1 || true
           docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker network create "$NET" >/dev/null
docker volume create "$VOL" >/dev/null   # fresh named volume => root:root 0755

owner_of(){ docker run --rm -v "$VOL":/backups alpine:3.20 sh -c 'ls -nd /backups | awk "{print \$3}"'; }

echo "== A: fresh volume is root-owned before init =="
[ "$(owner_of)" = "0" ] && ok "A: fresh volume owned by root (uid 0)" || no "A: unexpected owner"

echo "== B: entrypoint makes /backups node-writable (case 6/7) =="
docker run -d --name "$OWN" -v "$VOL":/backups -v "$ENTRY":/entry.sh:ro \
  --entrypoint /bin/sh node:20-alpine /entry.sh sleep 120 >/dev/null
sleep 2
[ "$(docker exec "$OWN" sh -c 'ls -nd /backups | awk "{print \$3}"')" = "1000" ] \
  && ok "B: /backups chowned to node uid 1000 by entrypoint" || no "B: not chowned to node"
docker exec -u 1000 "$OWN" sh -c 'echo hi > /backups/preexisting.sql.gz' \
  && ok "B: node (uid 1000) can write to /backups" || no "B: node cannot write"

echo "== C: restart is idempotent + preserves existing files (case 8) =="
docker rm -f "$OWN" >/dev/null
docker run -d --name "$OWN" -v "$VOL":/backups -v "$ENTRY":/entry.sh:ro \
  --entrypoint /bin/sh node:20-alpine /entry.sh sleep 120 >/dev/null
sleep 2
docker exec "$OWN" sh -c 'test -f /backups/preexisting.sql.gz' \
  && ok "C: pre-existing backup file survived restart" || no "C: file lost on restart"
[ "$(docker exec "$OWN" sh -c 'ls -nd /backups | awk "{print \$3}"')" = "1000" ] \
  && ok "C: ownership still node after restart (idempotent)" || no "C: ownership drifted"
[ "$(docker exec "$OWN" sh -c 'cat /backups/preexisting.sql.gz')" = "hi" ] \
  && ok "C: existing file content intact" || no "C: content changed"
docker rm -f "$OWN" >/dev/null

echo "== D: real pg_dump backup as node, DIRECT_URL preferred, no leak =="
docker run -d --name "$PG" --network "$NET" -e POSTGRES_PASSWORD=pw_synthetic postgres:17-alpine >/dev/null
# Wait for TCP, FROM ANOTHER CONTAINER -- the exact path backup-db.sh uses.
#
# `docker exec psql` was wrong here and made this drill flaky. It connects over
# the Unix socket INSIDE the container, and the official entrypoint runs a
# "socket-only postgresql server for setting up or running scripts" with
# `-c listen_addresses=''` while it initialises. So the socket answers `select 1`
# during init, the probe breaks out early, the entrypoint then STOPS that
# temporary server and restarts it for real -- and the backup, which connects
# over the network, lands in the gap and is refused.
#
# That is exactly how the 2026-09-12 nightly failed: D reported "backup failed"
# at 07:14:30.17, and E1/E2 connected over the network to the SAME container
# 0.3s later and both passed. The backup path was fine; the gate was not.
#
# PGHOST is a hostname, so psql connects over TCP -- never the socket.
if docker run --rm --network "$NET" -e PGPASSWORD=pw_synthetic -e PGHOST="$PG" \
  postgres:17-alpine \
  bash -c 'n=0; while [ $n -lt 60 ]; do psql -U postgres -d postgres -c "select 1" >/dev/null 2>&1 && exit 0; n=$((n+1)); sleep 1; done; exit 1' \
  >/dev/null 2>&1
then ok "D: postgres accepting TCP connections"
else no "D: postgres never accepted TCP (environment, not the backup path)"
fi
# Asserted, not silent: a failed seed would surface later as "dump empty/wrong",
# which points at the backup script rather than at the fixture.
docker exec "$PG" psql -U postgres -d postgres -c 'CREATE TABLE t(id int); INSERT INTO t VALUES (1),(2);' >/dev/null \
  && ok "D: seed schema created" || no "D: seed failed"
OUT="$(docker run --rm --network "$NET" -u 1000 -v "$VOL":/backups -v "$REPO/scripts":/app/scripts:ro \
  -e BACKUP_DIR=/backups \
  -e DIRECT_URL="postgresql://postgres:pw_synthetic@$PG:5432/postgres?sslmode=disable" \
  -e DATABASE_URL="postgresql://postgres:pw_synthetic@$PG:6543/postgres?pgbouncer=true" \
  postgres:17-alpine bash /app/scripts/backup-db.sh 2>&1)"
[ $? -eq 0 ] && ok "D: real backup succeeded as node" || no "D: backup failed"
echo "$OUT" | grep -q "Using DIRECT_URL" && ok "D: DIRECT_URL selected (log)" || no "D: DIRECT_URL not selected"
docker run --rm -v "$VOL":/backups postgres:17-alpine sh -c 'gzip -dc /backups/wizer-signage_*.sql.gz | grep -q "CREATE TABLE"' \
  && ok "D: dump contains real schema" || no "D: dump empty/wrong"
case "$OUT" in *pw_synthetic*) no "D: credential leaked in log" ;; *) ok "D: no credential in log" ;; esac

echo "== E: reproduce prod bug, then prove the fix =="
raw="$(docker run --rm --network "$NET" -u 1000 postgres:17-alpine \
  pg_dump --dbname="postgresql://postgres:pw_synthetic@$PG:5432/postgres?pgbouncer=true" 2>&1)"
case "$raw" in *pgbouncer*) ok "E1: raw pooled URL reproduces the pgbouncer error" ;; *) no "E1: no repro" ;; esac
OUT2="$(docker run --rm --network "$NET" -u 1000 -v "$VOL":/backups -v "$REPO/scripts":/app/scripts:ro \
  -e BACKUP_DIR=/backups \
  -e DATABASE_URL="postgresql://postgres:pw_synthetic@$PG:5432/postgres?pgbouncer=true&sslmode=disable" \
  postgres:17-alpine bash /app/scripts/backup-db.sh 2>&1)"
[ $? -eq 0 ] && ok "E2: pooled-only DATABASE_URL succeeds after stripping" || no "E2: failed"
echo "$OUT2" | grep -q "removed Prisma/PgBouncer-only query params" \
  && ok "E2: strip logged" || no "E2: strip not logged"

echo
echo "== e2e results: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
