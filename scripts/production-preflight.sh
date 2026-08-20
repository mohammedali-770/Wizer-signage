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
for command in docker curl awk grep sed df pg_dump timeout; do
  command -v "${command}" >/dev/null 2>&1 || fail "required command '${command}' is not installed"
done
pass "required host commands are present"
docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable by the deployment user"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is unavailable"
pass "Docker + Compose v2 are usable"

for file in "${BASE}" "${PROXY}" "${LOGGING}" "${SLOTS}" "${SLOTS_LOGGING}"; do
  [[ -f "${file}" ]] || fail "required production compose file missing: ${file}"
done

# CAPTCHA_SECRET is in this list because the API's env validation REFUSES TO BOOT
# without it in production. Without the check here the failure surfaces much
# later and much more expensively: preflight passes, images pull, the mandatory
# pre-migration backup runs, migrations apply, and only then does the inactive
# slot fail its health gate. Blue/green would not switch traffic, so there is no
# outage — but a whole release cycle is spent to learn about a missing string.
# Preflight is read-only and runs first; this belongs here.
for key in \
  APP_DOMAIN NEXT_PUBLIC_API_URL DATABASE_URL DIRECT_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY \
  IMAGE_REGISTRY_PREFIX METRICS_TOKEN BACKUP_OFFSITE_CMD HEALTHCHECKS_URL LOG_SHIPPING_ADDRESS \
  CAPTCHA_SECRET \
  SMTP_HOST SMTP_PORT SMTP_FROM SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_STORAGE_BUCKET; do
  require_value "${key}"
done

APP_DOMAIN="$(read_env_value APP_DOMAIN)"
[[ "${APP_DOMAIN}" =~ ^[A-Za-z0-9.-]+$ && "${APP_DOMAIN}" == *.* ]] \
  || fail "APP_DOMAIN must be a DNS hostname without scheme, port, credentials or path"
case "${APP_DOMAIN,,}" in localhost|127.*|10.*|192.168.*|*.local|*.invalid) fail "APP_DOMAIN points at a local/development hostname" ;; esac
pass "APP_DOMAIN looks production-like"

# This topology serves the API at /api on the same public domain as the dashboard.
# The dashboard URL is compiled into the immutable image, so the host-approved
# value must be exact; pull-release-images.sh verifies the corresponding image
# label before any local release tags are moved.
NEXT_PUBLIC_API_URL_VALUE="$(read_env_value NEXT_PUBLIC_API_URL)"
EXPECTED_API_URL="https://${APP_DOMAIN}/api"
[[ "${NEXT_PUBLIC_API_URL_VALUE}" == "${EXPECTED_API_URL}" ]] \
  || fail "NEXT_PUBLIC_API_URL must equal https://${APP_DOMAIN}/api for the production reverse-proxy topology"
pass "dashboard build API URL matches the production public API origin"

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

# Normalize before the no-op test. The previous literal comparison matched only
# `true`, `:`, `echo` and `echo *`, so `/bin/true`, `true ` (trailing space) and
# `true #comment` all passed as "a real off-host copy command".
offsite_first_word() {
  local cmd="${1%%[;&|]*}"          # first command in a list
  cmd="${cmd%%#*}"                  # drop a trailing comment
  cmd="${cmd#"${cmd%%[![:space:]]*}"}"
  cmd="${cmd%%[[:space:]]*}"        # first word
  cmd="${cmd##*/}"                  # basename, so /bin/true == true
  printf '%s' "${cmd}"
}
OFFSITE_BIN="$(offsite_first_word "${OFFSITE_CMD}")"
case "${OFFSITE_BIN}" in
  true|:|echo|cat|printf|test|nop|noop|'')
    fail "BACKUP_OFFSITE_CMD is a no-op; configure a real off-host copy command" ;;
esac
pass "offsite backup copy command is configured"

# Resolve that binary INSIDE THE MAINTENANCE IMAGE, not just on this host.
#
# The same BACKUP_OFFSITE_CMD is executed in two different filesystems: on the
# host by deploy-blue-green.sh at deploy time, and inside the maintenance
# container by the nightly cron job. Validating only the host is how a command
# that an operator successfully tests by hand goes on to fail — or silently
# transfer nothing — every night in the container. Checking the host would have
# passed `rclone copyto ...` while the container had no rclone at all.
#
# --rm and no volumes: this starts and discards one throwaway container and
# changes no host state, consistent with this script's read-only contract.
resolve_maintenance_image() {
  local img
  img="$(docker inspect -f '{{.Config.Image}}' wizer-signage-maintenance 2>/dev/null || true)"
  [[ -n "${img}" ]] && { printf '%s' "${img}"; return 0; }
  if [[ $# -gt 0 && -n "${1}" ]]; then
    img="${REGISTRY}/wizer-signage-maintenance:${1}"
    docker image inspect "${img}" >/dev/null 2>&1 && { printf '%s' "${img}"; return 0; }
  fi
  for img in "wizer-signage/maintenance:${IMAGE_TAG:-latest}" "wizer-signage/maintenance:latest"; do
    docker image inspect "${img}" >/dev/null 2>&1 && { printf '%s' "${img}"; return 0; }
  done
  return 1
}
if MAINTENANCE_IMAGE="$(resolve_maintenance_image "${1:-}")"; then
  docker run --rm --entrypoint sh "${MAINTENANCE_IMAGE}" -c "command -v '${OFFSITE_BIN}' >/dev/null 2>&1" \
    || fail "BACKUP_OFFSITE_CMD runs '${OFFSITE_BIN}', which does not exist in the maintenance image ${MAINTENANCE_IMAGE} that runs the nightly backup"
  pass "offsite copy command resolves inside the maintenance image"
else
  fail "cannot resolve the maintenance image to validate BACKUP_OFFSITE_CMD against; start the base stack or pull the release images first (blue/green is an adoption path — see docs/production-cutover.md §5)"
fi

# An exit status is not evidence that bytes arrived. backup-db.sh compares the
# remote object's size against the local dump, but only when this is set, so
# production requires it — otherwise a copy command that silently transfers
# nothing still reports success, pings the dead-man and prunes older backups.
OFFSITE_VERIFY_CMD="$(read_env_value BACKUP_OFFSITE_VERIFY_CMD)"
[[ -n "${OFFSITE_VERIFY_CMD}" ]] \
  || fail "BACKUP_OFFSITE_VERIFY_CMD is missing/empty in ${ENV_FILE}; the offsite copy would be assumed from an exit status rather than confirmed"
VERIFY_BIN="$(offsite_first_word "${OFFSITE_VERIFY_CMD}")"
case "${VERIFY_BIN}" in
  true|:|echo|cat|printf|test|nop|noop|'')
    fail "BACKUP_OFFSITE_VERIFY_CMD is a no-op; it must report the remote object's size in bytes" ;;
esac
docker run --rm --entrypoint sh "${MAINTENANCE_IMAGE}" -c "command -v '${VERIFY_BIN}' >/dev/null 2>&1" \
  || fail "BACKUP_OFFSITE_VERIFY_CMD runs '${VERIFY_BIN}', which does not exist in the maintenance image ${MAINTENANCE_IMAGE} that runs the nightly backup"
pass "offsite backup copy is verified against the local dump size"

# The host and the maintenance container must produce interchangeable dumps.
# backup-db.sh runs in both -- on the host at deploy time, in the container
# nightly -- and pg_dump 17+ writes `SET transaction_timeout = 0;` into the dump
# preamble, which PostgreSQL 16 and older reject. restore-db.sh pipes dumps into
# `psql --set ON_ERROR_STOP=on`, so a dump from a newer client aborts on the
# preamble before a single row is applied: a backup that appears to succeed
# every night and cannot be restored. Comparing the two majors here catches a
# host whose postgresql-client has drifted away from the pinned image (see
# infra/docker/Dockerfile.maintenance); both must track the server major.
host_pg_major() { pg_dump --version 2>/dev/null | sed -nE 's/.*[^0-9]([0-9]+)\.[0-9]+.*/\1/p'; }
HOST_PG_MAJOR="$(host_pg_major)"
IMAGE_PG_MAJOR="$(docker run --rm --entrypoint pg_dump "${MAINTENANCE_IMAGE}" --version 2>/dev/null | sed -nE 's/.*[^0-9]([0-9]+)\.[0-9]+.*/\1/p')"
[[ "${HOST_PG_MAJOR}" =~ ^[0-9]+$ ]] || fail "could not determine the host pg_dump major version"
[[ "${IMAGE_PG_MAJOR}" =~ ^[0-9]+$ ]] || fail "could not determine the pg_dump major version in ${MAINTENANCE_IMAGE}"
[[ "${HOST_PG_MAJOR}" == "${IMAGE_PG_MAJOR}" ]] \
  || fail "host pg_dump is major ${HOST_PG_MAJOR} but the maintenance image that takes the nightly backup is major ${IMAGE_PG_MAJOR}; dumps from a newer client cannot be restored into an older server"
pass "host and maintenance-image PostgreSQL clients are the same major (${HOST_PG_MAJOR})"

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

# Shape is not reachability. `fluentd-async: 'true'` means an unreachable
# collector costs nothing observable: containers start, stay healthy, keep
# serving, `docker logs` looks completely normal, and the Docker daemon logs no
# complaint -- while zero lines leave the host. Measured during the off-box
# logging drill: a wrong address delivered 0 of 33 lines with no signal anywhere.
#
# The connection is opened BY THE DOCKER DAEMON ON THIS HOST, not from inside a
# container network, so the address must resolve and connect from here. That
# distinction is easy to get wrong -- a Compose service name looks perfectly
# valid and can never work -- and this is the only place it is cheap to catch.
LOG_SHIPPING_HOST="${LOG_SHIPPING_ADDRESS_VALUE%:*}"

# The shape regex above forbids whitespace and colons but still admits shell
# metacharacters, so a value like '$(id):24224' would satisfy it. This value is
# interpolated into a connect attempt below, and preflight runs as the
# docker-privileged deploy user, so constrain it to an actual hostname or IPv4
# literal first and pass it as an argument rather than splicing it into code.
[[ "${LOG_SHIPPING_HOST}" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] \
  || fail "LOG_SHIPPING_ADDRESS host must be a DNS hostname or IPv4 literal"

# Retry before concluding anything. A single attempt turns a momentary blip at a
# third-party collector into a blocked deploy, and this gate is fail-closed.
log_collector_reachable() {
  local attempt
  for attempt in 1 2 3; do
    if timeout 5 bash -c 'printf "" >/dev/tcp/"$1"/"$2"' _ "${LOG_SHIPPING_HOST}" "${LOG_SHIPPING_PORT}" 2>/dev/null; then
      return 0
    fi
    (( attempt < 3 )) && sleep 2
  done
  return 1
}

if log_collector_reachable; then
  pass "log collector accepts connections from this host (${LOG_SHIPPING_ADDRESS_VALUE})"
elif [[ "${ALLOW_UNREACHABLE_LOG_COLLECTOR:-0}" == "1" ]]; then
  # Deliberate escape hatch, mirroring DEPLOY_SKIP_BACKUP in deploy-blue-green.sh.
  # `fluentd-async: 'true'` exists precisely so collector downtime never stops
  # Wizer from running, and refusing to ship an urgent fix because an
  # observability service is down would invert that. The release still starts
  # with a known hole in its off-box record, so say so loudly.
  printf 'WARNING [preflight]: log collector %s is unreachable; proceeding because ALLOW_UNREACHABLE_LOG_COLLECTOR=1.\n' \
    "${LOG_SHIPPING_ADDRESS_VALUE}" >&2
  printf 'WARNING [preflight]: logs from this release will be dropped until the collector returns.\n' >&2
else
  fail "log collector ${LOG_SHIPPING_ADDRESS_VALUE} is unreachable from this host after 3 attempts; the Docker daemon opens this connection, so an address that only resolves inside a container network will silently ship nothing. Set ALLOW_UNREACHABLE_LOG_COLLECTOR=1 to deploy anyway with logs dropped."
fi

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
