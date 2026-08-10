#!/usr/bin/env bash
# Wizer Signage — zero-downtime production deploy from immutable registry images.
#
# Starts the inactive API/dashboard slot, health-gates it, atomically switches a
# persistent nginx upstream include, graceful-reloads nginx, and automatically
# restores the previous upstream file if the public readiness/smoke gate fails.
# The previous dashboard stays alive as a static-chunk fallback; the previous API
# drains before it is stopped. Rollback can start the previous slot again.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BASE_COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.yml"
PROXY_COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.blue-green-proxy.yml"
LOG_COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.log-shipping.yml"
SLOTS_COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.blue-green-slots.yml"
SLOTS_LOG_COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.blue-green-log-shipping.yml"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
BG_HISTORY="${BLUE_GREEN_HISTORY:-${ROOT_DIR}/.blue-green-history}"
LEGACY_HISTORY="${DEPLOY_STATE:-${ROOT_DIR}/.deploy-history}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
API_DRAIN_SECONDS="${API_DRAIN_SECONDS:-75}"

[[ -f "${ENV_FILE}" ]] || { echo "ERROR: ${ENV_FILE} not found." >&2; exit 1; }
for required_file in "${BASE_COMPOSE_FILE}" "${PROXY_COMPOSE_FILE}" "${LOG_COMPOSE_FILE}" "${SLOTS_COMPOSE_FILE}" "${SLOTS_LOG_COMPOSE_FILE}"; do
  [[ -f "${required_file}" ]] || { echo "ERROR: required production compose file missing: ${required_file}" >&2; exit 1; }
done

# Production always includes off-box logging for BOTH base services and the
# blue/green serving slots. fluentd-async keeps collector downtime from blocking
# container startup, while cutover acceptance confirms logs are actually arriving.
BASE_COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${BASE_COMPOSE_FILE}" -f "${PROXY_COMPOSE_FILE}" -f "${LOG_COMPOSE_FILE}")
SLOTS_COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SLOTS_COMPOSE_FILE}" -f "${SLOTS_LOG_COMPOSE_FILE}")

read_env_value() {
  local key="$1"
  grep -E "^${key}=" "${ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"'\r' | xargs || true
}

IMAGE_REGISTRY_PREFIX="${IMAGE_REGISTRY_PREFIX:-$(read_env_value IMAGE_REGISTRY_PREFIX)}"
[[ -n "${IMAGE_REGISTRY_PREFIX}" ]] || {
  echo "ERROR: IMAGE_REGISTRY_PREFIX is required (for example ghcr.io/<owner>)." >&2
  exit 1
}
export IMAGE_REGISTRY_PREFIX

LOG_SHIPPING_ADDRESS="${LOG_SHIPPING_ADDRESS:-$(read_env_value LOG_SHIPPING_ADDRESS)}"
[[ -n "${LOG_SHIPPING_ADDRESS}" ]] || {
  echo "ERROR: LOG_SHIPPING_ADDRESS is required for production blue/green deployment." >&2
  exit 1
}
export LOG_SHIPPING_ADDRESS

APP_DOMAIN_VALUE="$(read_env_value APP_DOMAIN)"
PUBLIC_HEALTH_URL="${HEALTH_URL:-${APP_DOMAIN_VALUE:+https://${APP_DOMAIN_VALUE}/api/health/ready}}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-http://localhost/api/health/ready}"
SMOKE_URL="${SMOKE_URL:-${APP_DOMAIN_VALUE:+https://${APP_DOMAIN_VALUE}}}"
SMOKE_URL="${SMOKE_URL:-http://localhost}"

cd "${ROOT_DIR}"
echo "==> [blue-green] Starting deployment ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
git fetch --prune origin
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only origin "${DEPLOY_BRANCH}"
IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
FULL_SHA="$(git rev-parse HEAD)"
[[ "${IMAGE_TAG}" =~ ^[0-9a-f]{12}$ && "${FULL_SHA}" =~ ^${IMAGE_TAG}[0-9a-f]{28}$ ]] || {
  echo "ERROR: invalid git release identity." >&2; exit 1;
}

# The preferred production wrapper exports EXPECTED_RELEASE_SHA after verifying
# remote protected main. Enforce it again AFTER this script's own fetch/pull to
# close the race between wrapper validation and deployment target resolution.
if [[ -n "${EXPECTED_RELEASE_SHA:-}" ]]; then
  [[ "${EXPECTED_RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || {
    echo "ERROR: EXPECTED_RELEASE_SHA is not a full lowercase Git SHA." >&2; exit 1;
  }
  [[ "${FULL_SHA}" == "${EXPECTED_RELEASE_SHA}" ]] || {
    echo "ERROR: protected main moved after production-wrapper validation; no image pull/migration performed." >&2
    exit 1
  }
fi
export IMAGE_TAG

echo "==> [blue-green] Target ${FULL_SHA} (${IMAGE_TAG})"
bash "${SCRIPT_DIR}/pull-release-images.sh" "${IMAGE_TAG}"

# Backup remains fail-closed exactly like deploy-release.sh.
if [[ "${DEPLOY_SKIP_BACKUP:-0}" == "1" ]]; then
  echo "==> [blue-green] WARNING: pre-migration backup explicitly skipped." >&2
else
  echo "==> [blue-green] Taking pre-migration backup..."
  bash "${SCRIPT_DIR}/backup-db.sh" || {
    echo "ERROR: backup failed; no migration or traffic change performed." >&2; exit 1;
  }
fi

last_deployed_sha() {
  local sha=""
  if [[ -s "${BG_HISTORY}" ]]; then
    sha="$(tail -1 "${BG_HISTORY}" | awk '{print $4}')"
  elif [[ -s "${LEGACY_HISTORY}" ]]; then
    sha="$(tail -1 "${LEGACY_HISTORY}" | awk '{print $3}')"
  fi
  printf '%s' "${sha}"
}

# Zero-downtime DB compatibility guard. It is intentionally conservative and is
# not a proof of compatibility; it blocks the SQL shapes most likely to break
# the still-serving old process. An explicit override is a maintenance-window
# decision, not a normal blue/green deploy.
PREVIOUS_SHA="$(last_deployed_sha)"
if [[ "${PREVIOUS_SHA}" =~ ^[0-9a-f]{40}$ ]] && git cat-file -e "${PREVIOUS_SHA}^{commit}" 2>/dev/null; then
  mapfile -t NEW_MIGRATIONS < <(git diff --name-only "${PREVIOUS_SHA}..${FULL_SHA}" -- 'apps/api/prisma/migrations/*/migration.sql')
  if (( ${#NEW_MIGRATIONS[@]} > 0 )); then
    destructive=()
    for migration in "${NEW_MIGRATIONS[@]}"; do
      if grep -Eiq 'DROP[[:space:]]+(TABLE|COLUMN)|RENAME[[:space:]]+(COLUMN|TO)|ALTER[[:space:]]+COLUMN.*(TYPE|SET[[:space:]]+NOT[[:space:]]+NULL)' "${migration}"; then
        destructive+=("${migration}")
      fi
    done
    if (( ${#destructive[@]} > 0 )) && [[ "${ZERO_DOWNTIME_ALLOW_DESTRUCTIVE_MIGRATION:-0}" != "1" ]]; then
      printf 'ERROR: migration(s) need manual expand/contract review before zero-downtime deploy:\n' >&2
      printf '  %s\n' "${destructive[@]}" >&2
      echo "Use a staged expand/backfill/contract migration. The override is for an explicit maintenance window only." >&2
      exit 1
    fi
  fi
fi

echo "==> [blue-green] Applying migrations while the old slot continues serving..."
"${BASE_COMPOSE[@]}" run --rm --no-deps api ./node_modules/.bin/prisma migrate deploy

# First adoption only: recreate nginx with the blue/green template/runtime volume.
# The entrypoint writes a legacy-safe upstream file before nginx starts, so it
# still routes to the currently running api/dashboard services during bootstrap.
if ! docker inspect wizer-signage-nginx --format '{{range .Mounts}}{{if eq .Destination "/etc/nginx/runtime"}}yes{{end}}{{end}}' 2>/dev/null | grep -q yes; then
  echo "==> [blue-green] Bootstrapping persistent nginx runtime upstream volume (one-time topology adoption)..."
  "${BASE_COMPOSE[@]}" up -d --no-deps nginx
fi

ACTIVE_FILE=/etc/nginx/runtime/active-upstreams.conf
OLD_UPSTREAMS="$(docker exec wizer-signage-nginx cat "${ACTIVE_FILE}")"
if grep -q 'server api-blue:3001' <<<"${OLD_UPSTREAMS}"; then
  ACTIVE_SLOT=blue; INACTIVE_SLOT=green; OLD_API=api-blue; OLD_DASHBOARD=dashboard-blue
elif grep -q 'server api-green:3001' <<<"${OLD_UPSTREAMS}"; then
  ACTIVE_SLOT=green; INACTIVE_SLOT=blue; OLD_API=api-green; OLD_DASHBOARD=dashboard-green
else
  ACTIVE_SLOT=legacy; INACTIVE_SLOT=blue; OLD_API=api; OLD_DASHBOARD=dashboard
fi
NEW_API="api-${INACTIVE_SLOT}"
NEW_DASHBOARD="dashboard-${INACTIVE_SLOT}"

echo "==> [blue-green] Active=${ACTIVE_SLOT}; preparing inactive=${INACTIVE_SLOT}."
# Verified SHA tags are canonical. Slot aliases are local mutable pointers only;
# pull-release-images.sh already verified the OCI revision before this retag.
docker tag "wizer-signage/api:${IMAGE_TAG}" "wizer-signage/api:${INACTIVE_SLOT}"
docker tag "wizer-signage/dashboard:${IMAGE_TAG}" "wizer-signage/dashboard:${INACTIVE_SLOT}"

"${SLOTS_COMPOSE[@]}" up -d --no-build --no-deps --force-recreate \
  "api_${INACTIVE_SLOT}" "dashboard_${INACTIVE_SLOT}"

wait_healthy() {
  local container="$1" label="$2" attempt=1 status=""
  while (( attempt <= HEALTH_RETRIES )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container}" 2>/dev/null || true)"
    if [[ "${status}" == "healthy" ]]; then
      echo "    [blue-green] ${label} healthy."
      return 0
    fi
    sleep "${HEALTH_INTERVAL}"
    attempt=$(( attempt + 1 ))
  done
  echo "ERROR: ${label} did not become healthy (last status=${status:-missing})." >&2
  docker logs --tail=80 "${container}" >&2 || true
  return 1
}

if ! wait_healthy "wizer-signage-api-${INACTIVE_SLOT}" "API ${INACTIVE_SLOT}" || \
   ! wait_healthy "wizer-signage-dashboard-${INACTIVE_SLOT}" "dashboard ${INACTIVE_SLOT}"; then
  "${SLOTS_COMPOSE[@]}" stop "api_${INACTIVE_SLOT}" "dashboard_${INACTIVE_SLOT}" >/dev/null 2>&1 || true
  echo "ERROR: inactive slot failed before traffic switch; active traffic is untouched." >&2
  exit 1
fi

NEW_UPSTREAMS="$(cat <<EOF
# Active release ${IMAGE_TAG} (${FULL_SHA}); switched $(date -u +%Y-%m-%dT%H:%M:%SZ)
upstream api_upstream {
    server ${NEW_API}:3001;
    keepalive 32;
}
upstream dashboard_upstream {
    server ${NEW_DASHBOARD}:3000;
    keepalive 32;
}
upstream dashboard_static_upstream {
    server ${NEW_DASHBOARD}:3000;
    server ${OLD_DASHBOARD}:3000 backup;
    keepalive 32;
}
EOF
)"

write_and_reload() {
  local content="$1"
  printf '%s\n' "${content}" | docker exec -i wizer-signage-nginx sh -c "cat > ${ACTIVE_FILE}.next"
  docker exec wizer-signage-nginx sh -c "cp ${ACTIVE_FILE} ${ACTIVE_FILE}.previous && mv ${ACTIVE_FILE}.next ${ACTIVE_FILE}"
  if ! docker exec wizer-signage-nginx nginx -t; then
    docker exec wizer-signage-nginx sh -c "mv ${ACTIVE_FILE}.previous ${ACTIVE_FILE}" || true
    return 1
  fi
  if ! docker exec wizer-signage-nginx nginx -s reload; then
    docker exec wizer-signage-nginx sh -c "mv ${ACTIVE_FILE}.previous ${ACTIVE_FILE}" || true
    docker exec wizer-signage-nginx nginx -t >/dev/null 2>&1 && docker exec wizer-signage-nginx nginx -s reload >/dev/null 2>&1 || true
    return 1
  fi
  return 0
}

echo "==> [blue-green] Switching new nginx workers to ${INACTIVE_SLOT}..."
if ! write_and_reload "${NEW_UPSTREAMS}"; then
  echo "ERROR: nginx rejected the new slot; previous config restored." >&2
  exit 1
fi

automatic_rollback() {
  echo "==> [blue-green] Restoring previous nginx upstreams..." >&2
  if write_and_reload "${OLD_UPSTREAMS}"; then
    echo "==> [blue-green] Previous traffic route restored." >&2
  else
    echo "CRITICAL: automatic nginx traffic restore failed; inspect wizer-signage-nginx immediately." >&2
  fi
}

# New nginx workers are live. Existing workers continue draining old in-flight
# requests because nginx reload is graceful; do not stop the old API yet.
echo "==> [blue-green] Public readiness gate ${PUBLIC_HEALTH_URL} ..."
attempt=1
until curl -fsS "${PUBLIC_HEALTH_URL}" >/dev/null 2>&1; do
  if (( attempt >= HEALTH_RETRIES )); then
    automatic_rollback
    echo "ERROR: public readiness failed after switch." >&2
    exit 1
  fi
  sleep "${HEALTH_INTERVAL}"
  attempt=$(( attempt + 1 ))
done

if [[ "${SKIP_SMOKE:-0}" != "1" ]]; then
  echo "==> [blue-green] Public smoke gate ${SMOKE_URL} ..."
  if ! bash "${SCRIPT_DIR}/smoke-test.sh" "${SMOKE_URL}"; then
    automatic_rollback
    echo "ERROR: public smoke failed; traffic rolled back automatically." >&2
    exit 1
  fi
fi

# Maintenance is not user-facing; update it only after the new serving slot has
# passed public health/smoke. --no-deps prevents legacy api/dashboard recreation.
echo "==> [blue-green] Updating maintenance worker to ${IMAGE_TAG}..."
"${BASE_COMPOSE[@]}" up -d --no-build --no-deps maintenance

printf '%s %s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${INACTIVE_SLOT}" "${IMAGE_TAG}" "${FULL_SHA}" >> "${BG_HISTORY}"
if [[ "$(wc -l < "${BG_HISTORY}")" -gt "${DEPLOY_HISTORY_KEEP:-30}" ]]; then
  tail -n "${DEPLOY_HISTORY_KEEP:-30}" "${BG_HISTORY}" > "${BG_HISTORY}.tmp"
  mv "${BG_HISTORY}.tmp" "${BG_HISTORY}"
fi

# The old dashboard remains running as the backup upstream for old Next.js
# content-hashed chunks. The old API only needs the graceful worker/request drain.
if (( API_DRAIN_SECONDS > 0 )); then
  echo "==> [blue-green] Draining old API for ${API_DRAIN_SECONDS}s..."
  sleep "${API_DRAIN_SECONDS}"
fi
if [[ "${ACTIVE_SLOT}" == "legacy" ]]; then
  docker stop wizer-signage-api >/dev/null 2>&1 || true
else
  "${SLOTS_COMPOSE[@]}" stop "api_${ACTIVE_SLOT}" >/dev/null 2>&1 || true
  # Legacy dashboard is no longer a static backup after the second slot switch.
  docker stop wizer-signage-dashboard >/dev/null 2>&1 || true
fi

echo "==> [blue-green] SUCCESS — ${INACTIVE_SLOT} serves ${IMAGE_TAG}; ${OLD_DASHBOARD} remains static fallback/rollback asset source."
echo "==> [blue-green] Completed ($(date -u +%Y-%m-%dT%H:%M:%SZ))."
