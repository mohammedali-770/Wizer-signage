#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — telemetry partition physical-schema verifier (READ ONLY)
# =============================================================================
# Usage:
#   DIRECT_URL=postgresql://... bash scripts/assert-telemetry-partitions.sh
#
# This is the operator-facing post-migration/post-restore assertion. Prisma owns
# the two partitioned parent tables in public; PostgreSQL owns monthly children,
# the PoP idempotency registry and trigger internals in wizer_telemetry.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
if [[ -z "$DB_URL" ]]; then
  echo 'ERROR: DIRECT_URL or DATABASE_URL is required.' >&2
  exit 2
fi
command -v psql >/dev/null 2>&1 || { echo 'ERROR: psql is required.' >&2; exit 2; }

fail() { echo "ERROR: $*" >&2; exit 1; }
q() { psql "$DB_URL" -X -qAt --set=ON_ERROR_STOP=1 -c "$1"; }

# Parents must be RANGE-partitioned and keep canonical names visible to Prisma.
for parent in heartbeats proof_of_plays; do
  [[ "$(q "SELECT relkind FROM pg_class WHERE oid='public.${parent}'::regclass")" == p ]] \
    || fail "public.${parent} is not a partitioned parent"
  [[ "$(q "SELECT partstrat FROM pg_partitioned_table WHERE partrelid='public.${parent}'::regclass")" == r ]] \
    || fail "public.${parent} is not RANGE partitioned"
done

HEARTBEAT_PK="$(q "
  SELECT string_agg(a.attname, ',' ORDER BY u.ordinality)
  FROM pg_constraint con
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS u(attnum, ordinality)
  JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=u.attnum
  WHERE con.conrelid='public.heartbeats'::regclass AND con.contype='p'
")"
[[ "$HEARTBEAT_PK" == 'id,createdAt' ]] || fail "unexpected heartbeats PK: ${HEARTBEAT_PK:-<none>}"

POP_PK="$(q "
  SELECT string_agg(a.attname, ',' ORDER BY u.ordinality)
  FROM pg_constraint con
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS u(attnum, ordinality)
  JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=u.attnum
  WHERE con.conrelid='public.proof_of_plays'::regclass AND con.contype='p'
")"
[[ "$POP_PK" == 'id,startedAt' ]] || fail "unexpected proof_of_plays PK: ${POP_PK:-<none>}"

# The migration normalizes temporary copy/swap object names before completion.
BAD_NAMES="$(q "
  SELECT count(*)
  FROM (
    SELECT conname AS name
      FROM pg_constraint
     WHERE conrelid IN ('public.heartbeats'::regclass, 'public.proof_of_plays'::regclass)
    UNION ALL
    SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname IN ('public','wizer_telemetry')
       AND c.relkind='i'
  ) x
  WHERE name LIKE '%_partitioned_%'
")"
[[ "$BAD_NAMES" == 0 ]] || fail "$BAD_NAMES temporary _partitioned_ object name(s) remain"

# Both parents need at least current + future children. Exact month availability,
# internal namespace, registry PK and trigger/helper search_path are delegated to
# the stricter ownership verifier below.
for parent in heartbeats proof_of_plays; do
  CHILD_COUNT="$(q "SELECT count(*) FROM pg_inherits WHERE inhparent='public.${parent}'::regclass")"
  [[ "$CHILD_COUNT" =~ ^[0-9]+$ && "$CHILD_COUNT" -ge 2 ]] \
    || fail "public.${parent} has only ${CHILD_COUNT:-0} child partition(s)"
done

DIRECT_URL="$DB_URL" bash "$ROOT/scripts/assert-telemetry-partition-isolation.sh"

echo 'telemetry partition physical schema: OK'
