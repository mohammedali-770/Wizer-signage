#!/usr/bin/env bash
# Verify the physical PostgreSQL features Prisma cannot model directly.
# Read-only: safe against production and disposable restore-drill databases.
set -euo pipefail

DATABASE_URL_VALUE="${DATABASE_URL:-${DIRECT_URL:-}}"
[[ -n "${DATABASE_URL_VALUE}" ]] || {
  echo "ERROR [telemetry-check]: DATABASE_URL or DIRECT_URL is required." >&2
  exit 1
}
command -v psql >/dev/null 2>&1 || {
  echo "ERROR [telemetry-check]: psql is required." >&2
  exit 1
}

fail() { echo "ERROR [telemetry-check]: $*" >&2; exit 1; }
pass() { echo "  ok  $*"; }

query_scalar() {
  psql "${DATABASE_URL_VALUE}" -X -v ON_ERROR_STOP=1 -Atqc "$1"
}

printf '==> Verifying Wizer telemetry partition layout\n'

for table in heartbeats proof_of_plays; do
  strategy="$(query_scalar "
    SELECT pt.partstrat::text
      FROM pg_partitioned_table pt
      JOIN pg_class c ON c.oid = pt.partrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = '${table}';
  ")"
  [[ "${strategy}" == "r" ]] || fail "${table} is not a RANGE-partitioned parent"
  pass "${table} is RANGE partitioned"
done

registry_kind="$(query_scalar "
  SELECT c.relkind::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'proof_of_play_session_keys';
")"
[[ "${registry_kind}" == "r" ]] || fail "proof_of_play_session_keys is missing or not an ordinary unpartitioned table"
pass "proof-of-play global tenant session registry exists"

pk_definition="$(query_scalar "
  SELECT pg_get_constraintdef(con.oid)
    FROM pg_constraint con
   WHERE con.conrelid = 'public.proof_of_play_session_keys'::regclass
     AND con.contype = 'p';
")"
[[ "${pk_definition}" == *'"companyId", "playbackSessionId"'* ]] \
  || fail "session registry primary key is not (companyId, playbackSessionId)"
pass "tenant playback-session idempotency key is global across partitions"

triggers="$(query_scalar "
  SELECT string_agg(tgname, ',' ORDER BY tgname)
    FROM pg_trigger
   WHERE tgrelid = 'public.proof_of_plays'::regclass
     AND NOT tgisinternal;
")"
[[ ",${triggers}," == *',proof_of_plays_claim_session,'* ]] \
  || fail "proof_of_plays_claim_session trigger is missing"
[[ ",${triggers}," == *',proof_of_plays_release_session,'* ]] \
  || fail "proof_of_plays_release_session trigger is missing"
pass "claim/release idempotency triggers are installed"

# The rolling maintenance function is part of the physical schema contract.
function_exists="$(query_scalar "
  SELECT COUNT(*)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'wizer_ensure_telemetry_partitions';
")"
[[ "${function_exists}" =~ ^[1-9][0-9]*$ ]] || fail "wizer_ensure_telemetry_partitions function is missing"
pass "partition maintenance function exists"

# Ensure the current and next UTC month partitions exist for both parents. The
# deployment/maintenance job should stay ahead of the ingest clock; a missing
# next-month child is a future write outage waiting to happen.
missing="$(psql "${DATABASE_URL_VALUE}" -X -v ON_ERROR_STOP=1 -At <<'SQL'
WITH months AS (
  SELECT date_trunc('month', now() AT TIME ZONE 'UTC')::date AS month_start
  UNION ALL
  SELECT (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month')::date
), expected AS (
  SELECT parent,
         parent || '_y' || to_char(month_start, 'YYYY') || 'm' || to_char(month_start, 'MM') AS child
    FROM months
    CROSS JOIN (VALUES ('heartbeats'), ('proof_of_plays')) AS parents(parent)
), actual AS (
  SELECT parent.relname AS parent, child.relname AS child
    FROM pg_inherits i
    JOIN pg_class parent ON parent.oid = i.inhparent
    JOIN pg_class child ON child.oid = i.inhrelid
    JOIN pg_namespace n ON n.oid = parent.relnamespace
   WHERE n.nspname = 'public'
     AND parent.relname IN ('heartbeats', 'proof_of_plays')
)
SELECT expected.parent || ':' || expected.child
  FROM expected
  LEFT JOIN actual USING (parent, child)
 WHERE actual.child IS NULL
 ORDER BY 1;
SQL
)"
[[ -z "${missing}" ]] || fail "missing current/next telemetry partition(s): ${missing//$'\n'/, }"
pass "current and next-month children exist for both telemetry parents"

# Parent object names must be canonical after the lock/copy/swap migration;
# stale *_partitioned_* names are a drift/operability smell and complicate
# restore/debugging tooling.
stale_names="$(query_scalar "
  SELECT COUNT(*)
    FROM (
      SELECT conname AS name
        FROM pg_constraint
       WHERE conrelid IN ('public.heartbeats'::regclass, 'public.proof_of_plays'::regclass)
      UNION ALL
      SELECT indexname
        FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename IN ('heartbeats', 'proof_of_plays')
    ) names
   WHERE name LIKE '%\\_partitioned\\_%' ESCAPE '\\';
")"
[[ "${stale_names}" == "0" ]] || fail "temporary _partitioned_ parent constraint/index names remain"
pass "parent constraints/indexes use canonical names"

printf '==> TELEMETRY PARTITION CHECK PASSED\n'
