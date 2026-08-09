#!/usr/bin/env bash
# Wizer Signage — fail-closed production host preflight.
#
# This script is intentionally READ-ONLY: it does not pull images, migrate the
# database, restart containers, or modify nginx. Run it immediately before a
# production release/blue-green deployment. It prints variable NAMES and safe
# diagnostics only; secret values are never echoed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"
MIN_FREE_GB="${MIN_FREE_GB:-10}"
MIN_NOFILE="${MIN_NOFILE:-4096}"

BASE="${ROOT_DIR}/infra/docker/docker-compose.yml"
PROXY="${ROOT_DIR}/infra/docker/docker-compose.blue-green-proxy.yml"
SLOTS="${ROOT_DIR}/infra/docker/docker-compose.blue-green-slots.yml"

fail() { printf 'ERROR [preflight]: %s\n' "$*" >&2; exit 1; }
pass() { printf '  ok  %s\n' "$*"; }

[[ -f "${ENV_FILE}" ]] || fail "environment file not found: ${ENV_FILE}"
[[ -r "${ENV_FILE}" ]] || fail "environment file is not readable: ${ENV_FILE}"

read_env_value() {
  local key="$1"
  local raw
  raw="$(grep -E "^${key}=" "${ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  # Trim CR, surrounding quotes and ordinary whitespace without eval/source.
  raw="${raw//$'\r'/}"
  raw="${raw#\"}"; raw="${raw%\"}"
  raw="${raw#\'}"; raw="${raw%\'}"
  printf '%s' "${raw}" | xargs
}

require_value() {
  local key="$1" value
  value="$(read_env_value "${key}")"
  [[ -n "${value}" ]] || fail "${key} is missing/empty in ${ENV_FILE}"
  case "${value,,}" in
    *change-me*|*changeme*|*replace-me*|*example.invalid*|*ci-only*|*placeholder*)
      fail "${key} still contains a placeholder/development value" ;;
  esac
  pass "${key} is configured"
}

printf '==> Wizer production preflight\n'

for command in docker curl awk grep sed df; do
  command -v "${command}" >/dev/null 2>&1 || fail "required command '${command}' is not installed"
done
pass "required host commands are present"

docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable by the deployment user"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is unavailable"
pass "Docker + Compose v2 are usable"

for file in "${BASE}" "${PROXY}" "${SLOTS}"; do
  [[ -f "${file}" ]] || fail "required compose file missing: ${file}"
done

# Required application/deployment coordinates. Never print values.
for key in \
  APP_DOMAIN \
  DATABASE_URL \
  DIRECT_URL \
  JWT_ACCESS_SECRET \
  JWT_REFRESH_SECRET \
  ENCRYPTION_KEY \
  IMAGE_REGISTRY_PREFIX \
  METRICS_TOKEN; do
  require_value "${key}"
done

APP_DOMAIN="$(read_env_value APP_DOMAIN)"
case "${APP_DOMAIN,,}" in
  localhost|127.*|10.*|192.168.*|*.local|*.invalid)
    fail "APP_DOMAIN points at a local/development hostname" ;;
esac
[[ "${APP_DOMAIN}" != *://* ]] || fail "APP_DOMAIN must be a hostname, not a URL with a scheme"
[[ "${APP_DOMAIN}" != */* ]] || fail "APP_DOMAIN must not contain a path"
pass "APP_DOMAIN looks production-like"

REGISTRY="$(read_env_value IMAGE_REGISTRY_PREFIX)"
[[ "${REGISTRY}" =~ ^ghcr\.io/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$ ]] \
  || fail "IMAGE_REGISTRY_PREFIX must be a GHCR namespace such as ghcr.io/owner"
pass "registry prefix is a canonical GHCR namespace"

METRICS_TOKEN="$(read_env_value METRICS_TOKEN)"
(( ${#METRICS_TOKEN} >= 32 )) || fail "METRICS_TOKEN must be at least 32 characters"
pass "METRICS_TOKEN meets the minimum length"

for key in JWT_ACCESS_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY; do
  value="$(read_env_value "${key}")"
  (( ${#value} >= 32 )) || fail "${key} must be at least 32 characters"
done
pass "application secret lengths meet the production minimum"

for key in DATABASE_URL DIRECT_URL; do
  value="$(read_env_value "${key}")"
  [[ "${value}" =~ ^postgres(ql)?:// ]] || fail "${key} is not a PostgreSQL URL"
  case "${value,,}" in
    *localhost*|*127.0.0.1*) fail "${key} points at localhost" ;;
  esac
done
pass "database URLs are PostgreSQL and non-local"

# Render the exact production blue/green compose graph. Secrets may be consumed
# by Compose internally but the rendered config is discarded and never printed.
docker compose \
  --env-file "${ENV_FILE}" \
  -f "${BASE}" \
  -f "${PROXY}" \
  config --quiet >/dev/null \
  || fail "production proxy compose configuration is invalid"

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${SLOTS}" \
  config --quiet >/dev/null \
  || fail "blue/green slot compose configuration is invalid"
pass "production Compose graphs render successfully"

FREE_KB="$(df -Pk "${ROOT_DIR}" | awk 'NR==2 {print $4}')"
[[ "${FREE_KB}" =~ ^[0-9]+$ ]] || fail "could not determine free disk space"
MIN_KB=$(( MIN_FREE_GB * 1024 * 1024 ))
(( FREE_KB >= MIN_KB )) \
  || fail "less than ${MIN_FREE_GB} GiB free on the deployment filesystem"
pass "at least ${MIN_FREE_GB} GiB free disk is available"

NOFILE="$(ulimit -n)"
if [[ "${NOFILE}" != "unlimited" ]]; then
  [[ "${NOFILE}" =~ ^[0-9]+$ ]] || fail "could not determine open-file limit"
  (( NOFILE >= MIN_NOFILE )) || fail "open-file limit ${NOFILE} is below ${MIN_NOFILE}"
fi
pass "deployment user open-file limit is sufficient"

# Optional immutable release coordinate check. This proves the caller did not
# accidentally pass a branch/tag name as the deployment coordinate, without
# pulling any images or consuming registry bandwidth.
if [[ $# -gt 0 ]]; then
  TARGET_SHA="$1"
  [[ "${TARGET_SHA}" =~ ^[0-9a-f]{40}$ ]] || fail "target release must be a full 40-character lowercase Git SHA"
  pass "target release is an immutable full Git SHA"
fi

printf '==> PRE-FLIGHT PASSED — no host state was changed.\n'
