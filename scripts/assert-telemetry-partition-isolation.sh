#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — telemetry partition ownership verifier (READ ONLY)
# =============================================================================
# Usage:
#   DIRECT_URL=postgresql://... bash scripts/assert-telemetry-partition-isolation.sh
#
# Verifies the contract introduced after partition conversion:
#   - Prisma-owned parent tables stay in public;
#   - every child partition lives in wizer_telemetry;
#   - the PoP global idempotency registry lives in wizer_telemetry;
#   - registry trigger functions resolve the internal schema first;
#   - the public compatibility partition helper is pinned to that same search_path.
#
# It never writes data or DDL. Safe for post-migration and post-restore checks.
# =============================================================================
set -euo pipefail

DB_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
if [[ -z "$DB_URL" ]]; then
  echo 'ERROR: DIRECT_URL or DATABASE_URL is required.' >&2
  exit 2
fi
command -v psql >/dev/null 2>&1 || { echo 'ERROR: psql is required.' >&2; exit 2; }

fail() { echo "ERROR: $*" >&2; exit 1; }
q() { psql "$DB_URL" -X -qAt --set=ON_ERROR_STOP=1 -c "$1"; }

[[ "$(q "SELECT to_regclass('public.heartbeats') IS NOT NULL")" == t ]] \
  || fail 'public.heartbeats parent is missing'
[[ "$(q "SELECT to_regclass('public.proof_of_plays') IS NOT NULL")" == t ]] \
  || fail 'public.proof_of_plays parent is missing'
[[ "$(q "SELECT to_regclass('wizer_telemetry.proof_of_play_session_keys') IS NOT NULL")" == t ]] \
  || fail 'wizer_telemetry.proof_of_play_session_keys is missing'

# Both parents must themselves be partitioned tables.
[[ "$(q "SELECT relkind FROM pg_class WHERE oid='public.heartbeats'::regclass")" == p ]] \
  || fail 'public.heartbeats is not a partitioned table'
[[ "$(q "SELECT relkind FROM pg_class WHERE oid='public.proof_of_plays'::regclass")" == p ]] \
  || fail 'public.proof_of_plays is not a partitioned table'

# No monthly child is allowed to leak back into public or another schema.
BAD_CHILDREN="$(q "
  SELECT count(*)
  FROM pg_inherits i
  JOIN pg_class c ON c.oid=i.inhrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE i.inhparent IN ('public.heartbeats'::regclass,'public.proof_of_plays'::regclass)
    AND n.nspname <> 'wizer_telemetry'
")"
[[ "$BAD_CHILDREN" == 0 ]] || fail "$BAD_CHILDREN telemetry child partition(s) are outside wizer_telemetry"

# The registry is an ordinary table with the exact global tenant/session PK.
[[ "$(q "SELECT relkind FROM pg_class WHERE oid='wizer_telemetry.proof_of_play_session_keys'::regclass")" == r ]] \
  || fail 'proof_of_play_session_keys is not an ordinary table'
REGISTRY_PK="$(q "
  SELECT string_agg(a.attname, ',' ORDER BY u.ordinality)
  FROM pg_constraint con
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS u(attnum, ordinality)
  JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=u.attnum
  WHERE con.conrelid='wizer_telemetry.proof_of_play_session_keys'::regclass
    AND con.contype='p'
")"
[[ "$REGISTRY_PK" == 'companyId,playbackSessionId' ]] \
  || fail "unexpected PoP registry PK: ${REGISTRY_PK:-<none>}"

# Every custom PoP trigger function that references the registry must resolve the
# internal schema before public. This catches a registry move that leaves INSERT
# or DELETE trigger code pointing at a now-missing public table.
TRIGGER_CONFIG_BAD="$(q "
  SELECT count(*)
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE t.tgrelid='public.proof_of_plays'::regclass
    AND NOT t.tgisinternal
    AND pg_get_functiondef(p.oid) ILIKE '%proof_of_play_session_keys%'
    AND NOT ('search_path=wizer_telemetry, public' = ANY(COALESCE(p.proconfig, ARRAY[]::text[])))
")"
[[ "$TRIGGER_CONFIG_BAD" == 0 ]] \
  || fail "$TRIGGER_CONFIG_BAD PoP registry trigger function(s) lack the internal-first search_path"

# Keep the function in public for rolling-release compatibility, but force child
# creation into wizer_telemetry through function-level search_path.
HELPER_OID="$(q "
  SELECT p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='wizer_ensure_telemetry_partitions'
    AND pg_get_function_identity_arguments(p.oid)='months_ahead integer'
  LIMIT 1
")"
[[ -n "$HELPER_OID" ]] || fail 'public.wizer_ensure_telemetry_partitions(integer) is missing'
HELPER_PATH_OK="$(q "
  SELECT 'search_path=wizer_telemetry, public' = ANY(COALESCE(proconfig, ARRAY[]::text[]))
  FROM pg_proc WHERE oid=${HELPER_OID}
")"
[[ "$HELPER_PATH_OK" == t ]] || fail 'partition helper search_path is not wizer_telemetry, public'

# A restored database must already contain current + next month partitions for
# BOTH parents; otherwise the next month boundary can turn into an insert outage.
CURRENT_SUFFIX="$(date -u +%Y_%m)"
NEXT_SUFFIX="$(date -u -d "$(date -u +%Y-%m-01) +1 month" +%Y_%m 2>/dev/null || true)"
if [[ -z "$NEXT_SUFFIX" ]]; then
  # BSD/macOS date fallback (this script normally runs in Linux maintenance/CI).
  NEXT_SUFFIX="$(python3 - <<'PY'
from datetime import datetime
now=datetime.utcnow()
y,m=now.year,now.month
if m==12: y,m=y+1,1
else: m+=1
print(f'{y:04d}_{m:02d}')
PY
)"
fi
for suffix in "$CURRENT_SUFFIX" "$NEXT_SUFFIX"; do
  [[ "$(q "SELECT to_regclass('wizer_telemetry.heartbeats_${suffix}') IS NOT NULL")" == t ]] \
    || fail "missing wizer_telemetry.heartbeats_${suffix}"
  [[ "$(q "SELECT to_regclass('wizer_telemetry.proof_of_plays_${suffix}') IS NOT NULL")" == t ]] \
    || fail "missing wizer_telemetry.proof_of_plays_${suffix}"
done

echo 'telemetry partition isolation: OK'
