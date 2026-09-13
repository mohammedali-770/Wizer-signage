#!/usr/bin/env bash
# Pre-create the rolling monthly partitions used by heartbeat/proof-of-play.
# Safe to run repeatedly. Fails non-zero so cron/container logs surface a broken
# partition window before the first insert reaches an uncovered month boundary.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/pg-url.sh
source "${SCRIPT_DIR}/lib/pg-url.sh"

# This script APPLIES DDL (the wizer_ensure_telemetry_partitions call below) and
# deliberately never echoes the connection URL. A `set -a; source` here replaced
# an operator's exported scratch DIRECT_URL with the production one silently, so
# a run aimed at a throwaway database altered production instead. It sourced
# lib/pg-url.sh -- which exists to prevent exactly this -- and then did not use
# it. MONTHS_AHEAD is shielded for the same reason: it is read below and decides
# how much DDL runs.
#
# In the maintenance container (infra/docker/crontab:31) ROOT_DIR is /app and
# /app/.env does not exist, so this is a no-op there; the bug was only ever
# reachable on the host, which is why nothing caught it.
# shellcheck source=scripts/lib/env-file.sh
source "${SCRIPT_DIR}/lib/env-file.sh"
ENV_FILE="${ROOT_DIR}/.env"
env_load_defaults "${ENV_FILE}" DIRECT_URL DATABASE_URL TELEMETRY_PARTITION_MONTHS_AHEAD

MONTHS_AHEAD="${TELEMETRY_PARTITION_MONTHS_AHEAD:-6}"
[[ "${MONTHS_AHEAD}" =~ ^[0-9]+$ ]] || {
  echo "ERROR [telemetry-partitions]: TELEMETRY_PARTITION_MONTHS_AHEAD must be an integer." >&2
  exit 1
}
(( MONTHS_AHEAD >= 1 && MONTHS_AHEAD <= 24 )) || {
  echo "ERROR [telemetry-partitions]: months ahead must be between 1 and 24." >&2
  exit 1
}

command -v psql >/dev/null 2>&1 || {
  echo "ERROR [telemetry-partitions]: psql not found (postgresql-client required)." >&2
  exit 1
}

if ! DB_URL="$(resolve_pg_dump_url)"; then
  echo "ERROR [telemetry-partitions]: no usable DIRECT_URL/DATABASE_URL." >&2
  exit 1
fi

# Never echo DB_URL — it contains credentials.
echo "[telemetry-partitions] Ensuring current + ${MONTHS_AHEAD} monthly partitions..."
psql "${DB_URL}" \
  --set ON_ERROR_STOP=on \
  --no-psqlrc \
  --quiet \
  --command="SELECT public.wizer_ensure_telemetry_partitions(${MONTHS_AHEAD});"

echo "[telemetry-partitions] OK $(date -u +%Y-%m-%dT%H:%M:%SZ)"
