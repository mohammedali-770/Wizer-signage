#!/usr/bin/env bash
# Wizer Signage — fail-closed production host preflight.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"
MIN_FREE_GB="${MIN_FREE_GB:-10}"
MIN_NOFILE="${MIN_NOFILE:-4096}"

BASE="${ROOT_DIR}/infra/docker/docker-compose.yml"
PROXY="${ROOT_DIR}/infra/docker/docker-compose.blue-green-proxy.yml"
LOGGING="${ROOT_DIR}/infra/docker/docker-compose.log-shipping.yml"
SLOTS="${ROOT_DIR}/infra/docker/docker-compose.blue-green-slots.yml"
SLOTS_LOGGING="${ROOT_DIR}/infra/docker/docker-compose.blue-green-log-shipping.yml"

fail() { printf 'ERROR [preflight]: %s\n' "$*" >&2; exit 1; }
pass() { printf '  ok  %s\n' "$*"; }

[[ -f "${ENV_FILE}" ]] || fail "environment file not found: ${ENV_FILE}"
[[ -r "${ENV_FILE}" ]] || fail "environment file is not readable: ${ENV_FILE}"

read_env_value() {
  local key="$1" raw
  raw="$(grep -E "^${key}=" "${ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  raw="${raw//$'\r'/}"
  raw="${raw#\"}"; raw="${raw%\"}"
  raw="${raw#\'}"; raw="${raw%\'}"
  printf '%s' "${raw}" | xargs
}

is_placeholder() {
  local value="${1,,}"
  case "${value}" in
    *change-me*|*changeme*|*replace*|*placeholder*|*ci-only*|*example.invalid*|*__generate*|*__service*|*__smtp*|*your_github*|*your-provider*|*your-company*|*your-project*) return 0 ;;
  esac
  return 1
}

require_value() {
  local key="$1" value
  value="$(read_env_value "${key}")"
  [[ -n "${value}" ]] || fail "${key} is missing/empty in ${ENV_FILE}"
  ! is_placeholder "${value}" || fail "${key} still contains a placeholder/development value"
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

for file in "${BASE}" "${PROXY}" "${LOGGING}" "${SLOTS}" "${SLOTS_LOGGING}"; do
  [[ -f "${file}" ]] || fail "required production compose file missing: ${file}"
done

for key in \
  APP_DOMAIN DATABASE_URL DIRECT_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY \
  IMAGE_REGISTRY_PREFIX METRICS_TOKEN BACKUP_OFFSITE_CMD HEALTHCHECKS_URL LOG_SHIPPING_ADDRESS \
  SMTP_HOST SMTP_PORT SMTP_FROM SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_STORAGE_BUCKET; do
  require_value "${key}"
done

APP_DOMAIN="$(read_env_value APP_DOMAIN)"
case "${APP_DOMAIN,,}" in localhost|127.*|10.*|192.168.*|*.local|*.invalid) fail "APP_DOMAIN points at a local/development hostname" ;; esac
[[ "${APP_DOMAIN}" != *://* && "${APP_DOMAIN}" != */* ]] || fail "APP_DOMAIN must be a hostname without scheme/path"
pass "APP_DOMAIN looks production-like"

# configuration.ts resolves APP_URL first, then DASHBOARD_URL. Validate the same
# winner so password-reset/invitation links cannot silently fall back to localhost
# or be overridden by a stale APP_URL.
PUBLIC_DASHBOARD_URL="$(read_env_value APP_URL)"
[[ -n "${PUBLIC_DASHBOARD_URL}" ]] || PUBLIC_DASHBOARD_URL="$(read_env_value DASHBOARD_URL)"
[[ -n "${PUBLIC_DASHBOARD_URL}" ]] || fail "APP_URL or DASHBOARD_URL is required for production email links"
! is_placeholder "${PUBLIC_DASHBOARD_URL}" || fail "APP_URL/DASHBOARD_URL still contains a placeholder/development value"
[[ "${PUBLIC_DASHBOARD_URL}" =~ ^https://[^/?#[:space:]@]+(:[0-9]{1,5})?/?$ ]] \
  || fail "APP_URL/DASHBOARD_URL must be a public HTTPS origin without credentials, path, query or fragment"
DASHBOARD_HOST="${PUBLIC_DASHBOARD_URL#https://}"
DASHBOARD_HOST="${DASHBOARD_HOST%/}"
DASHBOARD_HOST="${DASHBOARD_HOST%%:*}"
case "${DASHBOARD_HOST,,}" in
  localhost|127.*|10.*|192.168.*|*.local|*.invalid) fail "APP_URL/DASHBOARD_URL points at a local/development host" ;;
  172.1[6-9].*|172.2[0-9].*|172.3[01].*) fail "APP_URL/DASHBOARD_URL points at a private host" ;;
esac
pass "public dashboard email-link origin is configured"

REGISTRY="$(read_env_value IMAGE_REGISTRY_PREFIX)"
[[ "${REGISTRY}" =~ ^ghcr\.io/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$ ]] || fail "IMAGE_REGISTRY_PREFIX must be a GHCR namespace such as ghcr.io/owner"
pass "registry prefix is a canonical GHCR namespace"

METRICS_TOKEN="$(read_env_value METRICS_TOKEN)"
(( ${#METRICS_TOKEN} >= 32 )) || fail "METRICS_TOKEN must be at least 32 characters"
for key in JWT_ACCESS_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY; do
  value="$(read_env_value "${key}")"
  (( ${#value} >= 32 )) || fail "${key} must be at least 32 characters"
done
pass "application/metrics secret lengths meet the production minimum"

for key in DATABASE_URL DIRECT_URL; do
  value="$(read_env_value "${key}")"
  [[ "${value}" =~ ^postgres(ql)?:// ]] || fail "${key} is not a PostgreSQL URL"
  case "${value,,}" in *localhost*|*127.0.0.1*) fail "${key} points at localhost" ;; esac
done
pass "database URLs are PostgreSQL and non-local"

SUPABASE_URL_VALUE="$(read_env_value SUPABASE_URL)"
[[ "${SUPABASE_URL_VALUE}" =~ ^https://[^[:space:]]+$ ]] || fail "SUPABASE_URL must be an HTTPS project URL"
SUPABASE_ROLE_VALUE="$(read_env_value SUPABASE_SERVICE_ROLE_KEY)"
(( ${#SUPABASE_ROLE_VALUE} >= 20 )) || fail "SUPABASE_SERVICE_ROLE_KEY is implausibly short"
SUPABASE_BUCKET_VALUE="$(read_env_value SUPABASE_STORAGE_BUCKET)"
[[ "${SUPABASE_BUCKET_VALUE}" =~ ^[A-Za-z0-9._-]{1,100}$ ]] || fail "SUPABASE_STORAGE_BUCKET has an invalid bucket name"
pass "persistent Supabase production storage is configured"

OFFSITE_CMD="$(read_env_value BACKUP_OFFSITE_CMD)"
case "${OFFSITE_CMD}" in true|:|echo|"echo "*) fail "BACKUP_OFFSITE_CMD is a no-op; configure a real off-host copy command" ;; esac
pass "offsite backup copy command is configured"

HEALTHCHECKS_URL_VALUE="$(read_env_value HEALTHCHECKS_URL)"
[[ "${HEALTHCHECKS_URL_VALUE}" =~ ^https://[^[:space:]]+$ ]] || fail "HEALTHCHECKS_URL must be an HTTPS dead-man monitoring URL"
case "${HEALTHCHECKS_URL_VALUE,,}" in *localhost*|*127.0.0.1*|*.invalid*|*00000000-0000-0000-0000-000000000000*) fail "HEALTHCHECKS_URL points at a placeholder/local target" ;; esac
pass "out-of-band backup dead-man monitoring is configured"

LOG_SHIPPING_ADDRESS_VALUE="$(read_env_value LOG_SHIPPING_ADDRESS)"
[[ "${LOG_SHIPPING_ADDRESS_VALUE}" =~ ^[^[:space:]:]+:[0-9]{1,5}$ ]] || fail "LOG_SHIPPING_ADDRESS must be a collector host:port"
LOG_SHIPPING_PORT="${LOG_SHIPPING_ADDRESS_VALUE##*:}"
(( LOG_SHIPPING_PORT >= 1 && LOG_SHIPPING_PORT <= 65535 )) || fail "LOG_SHIPPING_ADDRESS port must be 1-65535"
case "${LOG_SHIPPING_ADDRESS_VALUE,,}" in localhost:*|127.*|*.invalid:*|*.example:*) fail "LOG_SHIPPING_ADDRESS points at a placeholder/local collector" ;; esac
pass "off-box logging collector coordinate is configured"

SMTP_HOST_VALUE="$(read_env_value SMTP_HOST)"
case "${SMTP_HOST_VALUE,,}" in localhost|127.*|*.invalid|*.example.com) fail "SMTP_HOST points at a placeholder/local mail server" ;; esac
SMTP_PORT_VALUE="$(read_env_value SMTP_PORT)"
[[ "${SMTP_PORT_VALUE}" =~ ^[0-9]{1,5}$ ]] || fail "SMTP_PORT must be an integer port"
(( SMTP_PORT_VALUE >= 1 && SMTP_PORT_VALUE <= 65535 )) || fail "SMTP_PORT must be 1-65535"
SMTP_FROM_VALUE="$(read_env_value SMTP_FROM)"
[[ "${SMTP_FROM_VALUE}" == *"@"* ]] || fail "SMTP_FROM must contain a sender email address"
SMTP_USER_VALUE="$(read_env_value SMTP_USER)"
SMTP_PASSWORD_VALUE="$(read_env_value SMTP_PASSWORD)"
SMTP_PASS_VALUE="$(read_env_value SMTP_PASS)"
if [[ -n "${SMTP_USER_VALUE}" ]]; then
  [[ -n "${SMTP_PASSWORD_VALUE}" || -n "${SMTP_PASS_VALUE}" ]] || fail "SMTP_USER is configured but neither SMTP_PASSWORD nor SMTP_PASS is set"
  if [[ -n "${SMTP_PASSWORD_VALUE}" ]]; then ! is_placeholder "${SMTP_PASSWORD_VALUE}" || fail "SMTP_PASSWORD still contains a placeholder value"; fi
  if [[ -n "${SMTP_PASS_VALUE}" ]]; then ! is_placeholder "${SMTP_PASS_VALUE}" || fail "SMTP_PASS still contains a placeholder value"; fi
fi
pass "live SMTP delivery coordinates are configured"

docker compose --env-file "${ENV_FILE}" -f "${BASE}" -f "${PROXY}" -f "${LOGGING}" config --quiet >/dev/null || fail "production proxy/logging compose configuration is invalid"
docker compose --env-file "${ENV_FILE}" -f "${SLOTS}" -f "${SLOTS_LOGGING}" config --quiet >/dev/null || fail "blue/green slot/logging compose configuration is invalid"
pass "production Compose graphs including off-box logging render successfully"

FREE_KB="$(df -Pk "${ROOT_DIR}" | awk 'NR==2 {print $4}')"
[[ "${FREE_KB}" =~ ^[0-9]+$ ]] || fail "could not determine free disk space"
MIN_KB=$(( MIN_FREE_GB * 1024 * 1024 ))
(( FREE_KB >= MIN_KB )) || fail "less than ${MIN_FREE_GB} GiB free on the deployment filesystem"
pass "at least ${MIN_FREE_GB} GiB free disk is available"

NOFILE="$(ulimit -n)"
if [[ "${NOFILE}" != "unlimited" ]]; then
  [[ "${NOFILE}" =~ ^[0-9]+$ ]] || fail "could not determine open-file limit"
  (( NOFILE >= MIN_NOFILE )) || fail "open-file limit ${NOFILE} is below ${MIN_NOFILE}"
fi
pass "deployment user open-file limit is sufficient"

if [[ $# -gt 0 ]]; then
  TARGET_SHA="$1"
  [[ "${TARGET_SHA}" =~ ^[0-9a-f]{40}$ ]] || fail "target release must be a full 40-character lowercase Git SHA"
  pass "target release is an immutable full Git SHA"
fi

printf '==> PRE-FLIGHT PASSED — no host state was changed.\n'
