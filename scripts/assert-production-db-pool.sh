#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"

fail() { printf 'ERROR [db-pool]: %s\n' "$*" >&2; exit 1; }
[[ -r "${ENV_FILE}" ]] || fail "environment file is not readable: ${ENV_FILE}"

url="$(grep -E '^DATABASE_URL=' "${ENV_FILE}" | tail -1 | cut -d= -f2- || true)"
url="${url//$'\r'/}"
url="${url#\"}"; url="${url%\"}"
url="${url#\'}"; url="${url%\'}"
[[ -n "${url}" ]] || fail 'DATABASE_URL is missing'

extract_param() {
  local key="$1"
  printf '%s' "${url}" | sed -nE "s/.*([?&])${key}=([^&]+).*/\2/p"
}

connection_limit="$(extract_param connection_limit)"
pool_timeout="$(extract_param pool_timeout)"
[[ "${connection_limit}" =~ ^[0-9]+$ ]] || fail 'DATABASE_URL must set numeric connection_limit'
[[ "${pool_timeout}" =~ ^[0-9]+$ ]] || fail 'DATABASE_URL must set numeric pool_timeout'
(( connection_limit >= 1 && connection_limit <= 10 )) \
  || fail "connection_limit=${connection_limit} is outside the certified 1..10 range"
(( pool_timeout >= 1 && pool_timeout <= 30 )) \
  || fail "pool_timeout=${pool_timeout} is outside the certified 1..30 second range"
case "${url}" in
  *'pgbouncer=true'*) ;;
  *) fail 'pooled production DATABASE_URL must set pgbouncer=true' ;;
esac

printf '  ok  bounded Prisma runtime pool: connection_limit=%s pool_timeout=%ss\n' \
  "${connection_limit}" "${pool_timeout}"
