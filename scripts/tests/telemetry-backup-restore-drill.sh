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

# That restore ran WITHOUT RESTORE_DROP_ARCHIVE, so the pre-restore copy of the
# schemas it replaced must still be here. Retaining it by default is the point:
# it is the only remaining copy of whatever the target held, and the operator's
# last chance to compare against it.
ARCHIVES_RETAINED="$(client_query "$RESTORE_URL" "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'wizer_pre_restore_%'")"
[[ "$ARCHIVES_RETAINED" =~ ^[0-9]+$ && "$ARCHIVES_RETAINED" -ge 1 ]] || {
  echo "ERROR [telemetry-drill]: restore-db.sh kept no pre-restore archive by default." >&2
  exit 1
}
echo "  ok  pre-restore archive retained by default (${ARCHIVES_RETAINED})"

echo "== telemetry DR: run physical post-restore assertions =="
for verifier in assert-telemetry-partitions.sh assert-telemetry-partition-isolation.sh; do
  docker run --rm --network=host \
    -v "$REPO/scripts:/app/scripts:ro" \
    -e DIRECT_URL="$RESTORE_URL" \
    postgres:16-alpine \
    bash "/app/scripts/${verifier}"
  echo "  ok  ${verifier}"
done

# The restore above went into an EMPTY target, which is the easy half. The half
# that matters for disaster recovery is restoring over a database that already
# holds the migrated schema — and that is where this drill used to have a hole.
#
# `pg_dump --clean --if-exists` emits a DROP CONSTRAINT for every child
# partition's primary key, which PostgreSQL refuses because that key is inherited
# from the parent. The restore aborted after the preamble had already dropped
# every foreign key, so the target ended up neither intact nor restored. Nothing
# caught it: this drill only ever restored into a fresh instance, and the generic
# drill only covers non-partitioned tables. Restoring twice is the whole test.
echo "== telemetry DR: restore AGAIN over the now-migrated target =="
RESTORE_AGAIN="$(docker run --rm --network=host \
  -v "$REPO/scripts:/app/scripts:ro" \
  -v "$WORK/backups:/backups:ro" \
  -e FORCE=1 \
  -e RESTORE_DROP_ARCHIVE=1 \
  -e DIRECT_URL="$RESTORE_URL" \
  postgres:16-alpine \
  bash /app/scripts/restore-db.sh "/backups/$(basename "$DUMP")" 2>&1)" || {
    echo "$RESTORE_AGAIN" | tail -20 | sed 's/^/      /' >&2
    echo "ERROR [telemetry-drill]: restore-db.sh cannot restore over an existing migrated schema." >&2
    exit 1
  }
echo "  ok  migrated dump restored over an existing migrated schema"

REPEAT_CHILDREN="$(client_query "$RESTORE_URL" "SELECT count(*) FROM pg_inherits WHERE inhparent IN ('public.heartbeats'::regclass,'public.proof_of_plays'::regclass)")"
[[ "$REPEAT_CHILDREN" == "$SOURCE_CHILDREN" ]] || {
  echo "ERROR [telemetry-drill]: partition child count wrong after re-restore: source=${SOURCE_CHILDREN} restored=${REPEAT_CHILDREN}." >&2
  exit 1
}

# A restore that half-succeeds is worse than one that refuses, so prove the
# foreign keys are back rather than merely that the tables exist.
REPEAT_FKS="$(client_query "$RESTORE_URL" "SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace IN ('public'::regnamespace,'wizer_telemetry'::regnamespace)")"
[[ "$REPEAT_FKS" =~ ^[0-9]+$ && "$REPEAT_FKS" -ge 1 ]] || {
  echo "ERROR [telemetry-drill]: no foreign keys present after re-restore (${REPEAT_FKS:-0})." >&2
  exit 1
}
echo "  ok  ${REPEAT_CHILDREN} partitions and ${REPEAT_FKS} foreign keys intact after re-restore"

# The second restore set RESTORE_DROP_ARCHIVE=1, so it must have dropped ITS OWN
# archive and left the first restore's alone. Compare against the count taken
# after the first restore rather than against zero: an absolute check here would
# fail on the archive the default path is supposed to keep, blaming this restore
# for the previous one. Left uncleaned, every recovery would silently add another
# full copy of both schemas.
LEFTOVER="$(client_query "$RESTORE_URL" "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'wizer_pre_restore_%'")"
[[ "$LEFTOVER" == "$ARCHIVES_RETAINED" ]] || {
  echo "ERROR [telemetry-drill]: RESTORE_DROP_ARCHIVE=1 did not drop its archive (before=${ARCHIVES_RETAINED} after=${LEFTOVER})." >&2
  exit 1
}
echo "  ok  RESTORE_DROP_ARCHIVE=1 dropped its own archive and kept the earlier one"

echo "== telemetry DR: re-run physical assertions after the second restore =="
for verifier in assert-telemetry-partitions.sh assert-telemetry-partition-isolation.sh; do
  docker run --rm --network=host \
    -v "$REPO/scripts:/app/scripts:ro" \
    -e DIRECT_URL="$RESTORE_URL" \
    postgres:16-alpine \
    bash "/app/scripts/${verifier}"
  echo "  ok  ${verifier}"
done

echo "== TELEMETRY MIGRATED-SCHEMA BACKUP/RESTORE DRILL PASSED =="
