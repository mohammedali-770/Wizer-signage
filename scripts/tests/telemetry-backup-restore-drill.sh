#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — migrated telemetry backup/restore drill
# =============================================================================
# Runs against an EXISTING, already-migrated Wizer PostgreSQL database (the
# quality job's Postgres 16 service), takes a dump with the real backup-db.sh,
# restores that dump into a separate scratch Postgres 16 instance, then proves
# the partition parents/children/registry/triggers/helper survived the round trip.
#
# This is intentionally an extension of backup-restore-drill.sh, not another CI
# job, so production-readiness recovery depth does not consume another runner.
#
# Source URL priority:
#   TELEMETRY_DR_SOURCE_URL > DIRECT_URL > DATABASE_URL
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_URL="${TELEMETRY_DR_SOURCE_URL:-${DIRECT_URL:-${DATABASE_URL:-}}}"
[[ -n "$SOURCE_URL" ]] || {
  echo "ERROR [telemetry-drill]: TELEMETRY_DR_SOURCE_URL, DIRECT_URL or DATABASE_URL is required." >&2
  exit 2
}
command -v docker >/dev/null 2>&1 || {
  echo "ERROR [telemetry-drill]: docker is required." >&2
  exit 2
}

PG="bkdrill_telemetry_pg"
PORT="${BKDRILL_TELEMETRY_PORT:-55433}"
PASSWORD="pw_telemetry_drill"
RESTORE_URL="postgresql://postgres:${PASSWORD}@127.0.0.1:${PORT}/postgres?sslmode=disable"
WORK="$(mktemp -d)"

cleanup() {
  docker rm -f "$PG" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
cleanup
mkdir -p "$WORK/backups"

client_query() {
  local url="$1" sql="$2"
  docker run --rm --network=host \
    -e WIZER_PSQL_URL="$url" \
    -e WIZER_PSQL_SQL="$sql" \
    postgres:16-alpine \
    sh -c 'psql "$WIZER_PSQL_URL" -X -qAt --set=ON_ERROR_STOP=1 -c "$WIZER_PSQL_SQL"'
}

echo "== telemetry DR: verify source is the migrated Wizer schema =="
SOURCE_READY="$(client_query "$SOURCE_URL" "SELECT to_regclass('public.heartbeats') IS NOT NULL AND to_regclass('wizer_telemetry.proof_of_play_session_keys') IS NOT NULL")"
[[ "$SOURCE_READY" == "t" ]] || {
  echo "ERROR [telemetry-drill]: source database does not contain the migrated telemetry ownership boundary." >&2
  exit 1
}
SOURCE_CHILDREN="$(client_query "$SOURCE_URL" "SELECT count(*) FROM pg_inherits WHERE inhparent IN ('public.heartbeats'::regclass,'public.proof_of_plays'::regclass)")"
[[ "$SOURCE_CHILDREN" =~ ^[0-9]+$ && "$SOURCE_CHILDREN" -ge 4 ]] || {
  echo "ERROR [telemetry-drill]: source has only ${SOURCE_CHILDREN:-0} telemetry child partitions." >&2
  exit 1
}
echo "  ok  migrated source has ${SOURCE_CHILDREN} telemetry child partitions"

echo "== telemetry DR: take backup with production script =="
BACKUP_OUT="$(docker run --rm --network=host -u "$(id -u)" \
  -v "$REPO/scripts:/app/scripts:ro" \
  -v "$WORK/backups:/backups" \
  -e BACKUP_DIR=/backups \
  -e DIRECT_URL="$SOURCE_URL" \
  -e BACKUP_OFFSITE_CMD=true \
  postgres:16-alpine \
  bash /app/scripts/backup-db.sh 2>&1)" || {
    echo "$BACKUP_OUT" | sed 's/^/      /' >&2
    echo "ERROR [telemetry-drill]: backup-db.sh failed against migrated source." >&2
    exit 1
  }
DUMP="$(ls "$WORK"/backups/wizer-signage_*.sql.gz 2>/dev/null | head -1)"
[[ -n "$DUMP" && -s "$DUMP" ]] || {
  echo "ERROR [telemetry-drill]: migrated-source dump was not produced." >&2
  exit 1
}
echo "  ok  migrated-source dump created"

echo "== telemetry DR: start isolated restore target =="
docker run -d --name "$PG" --network=host \
  -e POSTGRES_PASSWORD="$PASSWORD" \
  postgres:16-alpine -c "port=${PORT}" >/dev/null
READY=0
for _ in $(seq 1 40); do
  if docker exec "$PG" psql -U postgres -p "$PORT" -d postgres -c 'select 1' >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
[[ "$READY" == "1" ]] || {
  echo "ERROR [telemetry-drill]: scratch Postgres did not become ready." >&2
  exit 1
}

echo "== telemetry DR: restore migrated dump =="
RESTORE_OUT="$(docker run --rm --network=host \
  -v "$REPO/scripts:/app/scripts:ro" \
  -v "$WORK/backups:/backups:ro" \
  -e FORCE=1 \
  -e DIRECT_URL="$RESTORE_URL" \
  postgres:16-alpine \
  bash /app/scripts/restore-db.sh "/backups/$(basename "$DUMP")" 2>&1)" || {
    echo "$RESTORE_OUT" | tail -20 | sed 's/^/      /' >&2
    echo "ERROR [telemetry-drill]: restore-db.sh failed for migrated dump." >&2
    exit 1
  }
echo "  ok  migrated dump restored"

RESTORED_CHILDREN="$(client_query "$RESTORE_URL" "SELECT count(*) FROM pg_inherits WHERE inhparent IN ('public.heartbeats'::regclass,'public.proof_of_plays'::regclass)")"
[[ "$RESTORED_CHILDREN" == "$SOURCE_CHILDREN" ]] || {
  echo "ERROR [telemetry-drill]: partition child count changed across restore: source=${SOURCE_CHILDREN} restored=${RESTORED_CHILDREN}." >&2
  exit 1
}
echo "  ok  restored all ${RESTORED_CHILDREN} telemetry child partitions"

echo "== telemetry DR: run physical post-restore assertions =="
for verifier in assert-telemetry-partitions.sh assert-telemetry-partition-isolation.sh; do
  docker run --rm --network=host \
    -v "$REPO/scripts:/app/scripts:ro" \
    -e DIRECT_URL="$RESTORE_URL" \
    postgres:16-alpine \
    bash "/app/scripts/${verifier}"
  echo "  ok  ${verifier}"
done

echo "== TELEMETRY MIGRATED-SCHEMA BACKUP/RESTORE DRILL PASSED =="
