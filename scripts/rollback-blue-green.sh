#!/usr/bin/env bash
# Wizer Signage — one-release blue/green traffic rollback.
# Database migrations are NOT reversed here. Blue/green deploys require
# expand/contract-compatible migrations so the previous application can run on
# the forward schema while traffic is switched back.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"
BASE="${ROOT_DIR}/infra/docker/docker-compose.yml"
PROXY="${ROOT_DIR}/infra/docker/docker-compose.blue-green-proxy.yml"
LOGGING="${ROOT_DIR}/infra/docker/docker-compose.log-shipping.yml"
SLOTS="${ROOT_DIR}/infra/docker/docker-compose.blue-green-slots.yml"
SLOTS_LOGGING="${ROOT_DIR}/infra/docker/docker-compose.blue-green-log-shipping.yml"
BG_HISTORY="${BLUE_GREEN_HISTORY:-${ROOT_DIR}/.blue-green-history}"
ROLLBACK_HISTORY="${BLUE_GREEN_ROLLBACK_HISTORY:-${BG_HISTORY}.rollbacks}"
LEGACY_HISTORY="${DEPLOY_STATE:-${ROOT_DIR}/.deploy-history}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
API_DRAIN_SECONDS="${API_DRAIN_SECONDS:-75}"

[[ -f "${ENV_FILE}" ]] || { echo "ERROR: ${ENV_FILE} not found." >&2; exit 1; }
[[ -s "${BG_HISTORY}" ]] || { echo "ERROR: no blue/green deployment history exists." >&2; exit 1; }
for required_file in "${BASE}" "${PROXY}" "${LOGGING}" "${SLOTS}" "${SLOTS_LOGGING}"; do
  [[ -f "${required_file}" ]] || { echo "ERROR: required production compose file missing: ${required_file}" >&2; exit 1; }
done

BASE_COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${BASE}" -f "${PROXY}" -f "${LOGGING}")
SLOTS_COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SLOTS}" -f "${SLOTS_LOGGING}")

read_env_value() {
  local key="$1"
  grep -E "^${key}=" "${ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"'\r' | xargs || true
}
IMAGE_REGISTRY_PREFIX="${IMAGE_REGISTRY_PREFIX:-$(read_env_value IMAGE_REGISTRY_PREFIX)}"
export IMAGE_REGISTRY_PREFIX
LOG_SHIPPING_ADDRESS="${LOG_SHIPPING_ADDRESS:-$(read_env_value LOG_SHIPPING_ADDRESS)}"
[[ -n "${LOG_SHIPPING_ADDRESS}" ]] || {
  echo "ERROR: LOG_SHIPPING_ADDRESS is required for production rollback logging." >&2
  exit 1
}
export LOG_SHIPPING_ADDRESS
APP_DOMAIN_VALUE="$(read_env_value APP_DOMAIN)"
PUBLIC_HEALTH_URL="${HEALTH_URL:-${APP_DOMAIN_VALUE:+https://${APP_DOMAIN_VALUE}/api/health/ready}}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-http://localhost/api/health/ready}"
SMOKE_URL="${SMOKE_URL:-${APP_DOMAIN_VALUE:+https://${APP_DOMAIN_VALUE}}}"
SMOKE_URL="${SMOKE_URL:-http://localhost}"

ACTIVE_FILE=/etc/nginx/runtime/active-upstreams.conf
OLD_UPSTREAMS="$(docker exec wizer-signage-nginx cat "${ACTIVE_FILE}")"

# Derive CURRENT from the live proxy, not the last deployment-history line.
# After B -> A rollback the history still ends in B by design; trusting it here
# would make a second rollback believe the known-bad B is still serving.
if grep -q 'server api-blue:3001' <<<"${OLD_UPSTREAMS}"; then
  CURRENT_SLOT=blue
  CURRENT_API_CONTAINER=wizer-signage-api-blue
  CURRENT_DASHBOARD=dashboard-blue
elif grep -q 'server api-green:3001' <<<"${OLD_UPSTREAMS}"; then
  CURRENT_SLOT=green
  CURRENT_API_CONTAINER=wizer-signage-api-green
  CURRENT_DASHBOARD=dashboard-green
else
  CURRENT_SLOT=legacy
  CURRENT_API_CONTAINER=wizer-signage-api
  CURRENT_DASHBOARD=dashboard
fi

CURRENT_SHA="$(docker inspect "${CURRENT_API_CONTAINER}" --format '{{index .Config.Image}}' 2>/dev/null | xargs docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
if [[ "${CURRENT_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  CURRENT_TAG="${CURRENT_SHA:0:12}"
else
  CURRENT_SHA=""
  CURRENT_TAG=""
  # Compatibility fallback for legacy/local images without OCI revision labels.
  if [[ "${CURRENT_SLOT}" == "legacy" ]]; then
    CURRENT_TAG="$(tail -1 "${LEGACY_HISTORY}" 2>/dev/null | awk '{print $2}' || true)"
    CURRENT_SHA="$(tail -1 "${LEGACY_HISTORY}" 2>/dev/null | awk '{print $3}' || true)"
  else
    CURRENT_LINE="$(tac "${BG_HISTORY}" | awk -v slot="${CURRENT_SLOT}" '$2 == slot { print; exit }')"
    CURRENT_TAG="$(awk '{print $3}' <<<"${CURRENT_LINE}")"
    CURRENT_SHA="$(awk '{print $4}' <<<"${CURRENT_LINE}")"
  fi
fi

echo "==> [rollback] Live traffic is ${CURRENT_SLOT}/${CURRENT_TAG:-unknown}."

# A release that was explicitly rolled away from is a known-bad rollback target,
# so a repeated rollback steps farther back instead of toggling A <-> known-bad B.
#
# That mark is deliberately NOT permanent. It records that a release was escaped
# at a point in time, and redeploying that exact release supersedes it:
# deploy-blue-green.sh appends to BG_HISTORY only after the release has passed
# the public readiness and smoke gates, so a deployment line strictly NEWER than
# the rollback-away line is positive evidence the release serves correctly again.
# That is the normal outcome when the original outage was environmental rather
# than in this code. Without the comparison the mark is unfalsifiable: a release
# could never be reached again however many times it was successfully shipped,
# and repeated rollbacks would drain toward the unverified `legacy` branch.
#
# Only a redeployment of the SAME tag clears it. A newer, different release says
# nothing about the bad one and must not clear it. Equal timestamps stay
# excluded, so clearing requires evidence that is unambiguously later.
#
# Both logs are append-only and written only after success, so failed attempts
# never poison this set.
latest_timestamp() { sort | tail -1; }

rolled_away_at() {
  sed -nE "s|^([^ ]+) ROLLBACK from=[^/]+/$1 .*|\\1|p" "${ROLLBACK_HISTORY}" 2>/dev/null | latest_timestamp
}

redeployed_at() {
  awk -v tag="$1" '$3 == tag { print $1 }' "${BG_HISTORY}" 2>/dev/null | latest_timestamp
}

is_rolled_away() {
  local tag="$1" rolled deployed
  [[ -n "${tag}" ]] || return 1
  rolled="$(rolled_away_at "${tag}")"
  [[ -n "${rolled}" ]] || return 1
  deployed="$(redeployed_at "${tag}")"
  [[ -n "${deployed}" && "${deployed}" > "${rolled}" ]] && return 1
  return 0
}

# Walk successful deployments newest-first. Skip the release currently serving
# and every release already rolled away from. This makes repeated rollback move
# farther back instead of toggling A <-> known-bad B.
PREVIOUS_LINE=""
while IFS= read -r line; do
  [[ -n "${line}" ]] || continue
  slot="$(awk '{print $2}' <<<"${line}")"
  tag="$(awk '{print $3}' <<<"${line}")"
  sha="$(awk '{print $4}' <<<"${line}")"
  [[ "${slot}" == "blue" || "${slot}" == "green" ]] || continue
  [[ "${tag}" =~ ^[0-9a-f]{12}$ && "${sha}" =~ ^[0-9a-f]{40}$ ]] || continue
  if [[ -n "${CURRENT_SHA}" && "${sha}" == "${CURRENT_SHA}" ]]; then continue; fi
  if [[ -n "${CURRENT_TAG}" && "${tag}" == "${CURRENT_TAG}" ]]; then continue; fi
  if is_rolled_away "${tag}"; then continue; fi
  PREVIOUS_LINE="${line}"
  break
done < <(tac "${BG_HISTORY}")

# Where the target release ORIGINALLY ran is not where it has to run now. A slot
# tag (wizer-signage/api:blue) is only a pointer: ensure_slot_image below retags
# it from the immutable release tag, exactly as the deploy does, so any release
# can be placed in either slot.
#
# That matters because the history slot is sometimes the slot already serving.
# Skip one release in an alternating history and the next candidate is two back,
# on the same colour. Bringing the target up there would recreate the containers
# handling live traffic — an in-place replacement with no health-gated standby,
# which is the single thing blue/green exists to prevent. The upstream it then
# wrote would also name the same host as both primary and backup.
#
# So the target always goes to the slot that is NOT serving. With two slots that
# is fully determined by the live one and needs no reference to the history. The
# ordinary alternating case resolves to the slot it always did, so nothing
# changes there; only the degenerate case is diverted.
opposite_slot() {
  case "$1" in
    blue) echo green ;;
    green) echo blue ;;
    *) echo "" ;;
  esac
}

if [[ -n "${PREVIOUS_LINE}" ]]; then
  TARGET_TAG="$(awk '{print $3}' <<<"${PREVIOUS_LINE}")"
  TARGET_SHA="$(awk '{print $4}' <<<"${PREVIOUS_LINE}")"
  TARGET_SLOT="$(opposite_slot "${CURRENT_SLOT}")"
  # Legacy is serving, so neither slot is in use and both are free. Keep the
  # release where it already ran; its images are most likely still tagged there.
  [[ -n "${TARGET_SLOT}" ]] || TARGET_SLOT="$(awk '{print $2}' <<<"${PREVIOUS_LINE}")"
else
  TARGET_SLOT=legacy
  TARGET_TAG="$(tail -1 "${LEGACY_HISTORY}" 2>/dev/null | awk '{print $2}' || true)"
  TARGET_SHA="$(tail -1 "${LEGACY_HISTORY}" 2>/dev/null | awk '{print $3}' || true)"
fi

# Invariant: a rollback has to move traffic somewhere else. After the rule above
# the only way to reach this is legacy -> legacy — legacy already serving and
# every blue/green release either live or excluded. There is nothing to switch
# to, and restarting the serving containers would be a self-inflicted outage.
if [[ "${TARGET_SLOT}" == "${CURRENT_SLOT}" ]]; then
  echo "ERROR: no rollback target other than the ${CURRENT_SLOT} release already serving." >&2
  echo "       Every recorded blue/green release is either live or already rolled away from." >&2
  echo "       This is a restore, not a traffic rollback — see docs/production-cutover.md section 9." >&2
  exit 1
fi

wait_healthy() {
  local container="$1" label="$2" attempt=1 status=""
  while (( attempt <= HEALTH_RETRIES )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container}" 2>/dev/null || true)"
    [[ "${status}" == "healthy" ]] && { echo "    [rollback] ${label} healthy."; return 0; }
    sleep "${HEALTH_INTERVAL}"
    attempt=$(( attempt + 1 ))
  done
  echo "ERROR: ${label} did not become healthy (last=${status:-missing})." >&2
  return 1
}

ensure_slot_image() {
  local component="$1" slot="$2" tag="$3" expected_sha="$4"
  local image="wizer-signage/${component}:${slot}"
  local actual=""
  actual="$(docker image inspect "${image}" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
  if [[ "${actual}" == "${expected_sha}" ]]; then return 0; fi
  [[ -n "${IMAGE_REGISTRY_PREFIX}" && "${tag}" =~ ^[0-9a-f]{12}$ ]] || {
    echo "ERROR: previous ${component} slot image is missing/mismatched and registry recovery is unavailable." >&2
    return 1
  }
  echo "==> [rollback] Re-pulling verified release ${tag} for ${slot}..."
  bash "${SCRIPT_DIR}/pull-release-images.sh" "${tag}"
  docker tag "wizer-signage/${component}:${tag}" "${image}"
  actual="$(docker image inspect "${image}" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
  [[ "${actual}" == "${expected_sha}" ]] || {
    echo "ERROR: recovered ${component} image revision '${actual}' != '${expected_sha}'." >&2
    return 1
  }
}

# The maintenance worker carries no traffic and is not slot-based, which is why
# it is easy to leave behind in a rollback -- and why leaving it behind is the
# most dangerous omission available here. deploy-blue-green.sh moves it onto the
# new release image once the public gates pass, so a rollback that only moves
# api/dashboard/nginx leaves the nightly `backup-db.sh`, the TLS expiry check and
# the log-shipping canary all running the release just judged bad. Two releases
# in this repository's history were bad in precisely that component: one shipped
# a pg_dump major the production server rejects, so every dump was unrestorable,
# and one shipped a transfer path that truncated a gzip dump to 3 bytes and
# exited 0. Rolling the app back while the backup worker keeps running that code
# is the worst of both states: the outage reads as resolved while the data
# protection is still broken.
#
# Returns 0 when the maintenance worker is known not to be running the release
# being escaped, 1 when it is (or may be) and could not be moved off it.
maintenance_revision() {
  docker inspect wizer-signage-maintenance --format '{{index .Config.Image}}' 2>/dev/null \
    | xargs docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null \
    || true
}

restore_maintenance_worker() {
  local tag="$1" expected_sha="$2"
  local image actual=""

  # The legacy fallback has no recorded release, so there is no known-good
  # maintenance image to return to. That is only a problem if the worker is
  # actually on the release being escaped; if it never moved, leave it alone.
  if [[ -z "${tag}" || -z "${expected_sha}" ]]; then
    local running; running="$(maintenance_revision)"
    if [[ -n "${CURRENT_SHA}" && "${running}" == "${CURRENT_SHA}" ]]; then
      echo "ERROR: the maintenance worker runs ${CURRENT_SHA}, the release being rolled away from," >&2
      echo "       and the rollback target records no maintenance release to return it to." >&2
      return 1
    fi
    echo "    [rollback] Maintenance worker is not on the rolled-back release; left as is."
    return 0
  fi

  image="wizer-signage/maintenance:${tag}"
  actual="$(docker image inspect "${image}" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
  if [[ "${actual}" != "${expected_sha}" ]]; then
    [[ -n "${IMAGE_REGISTRY_PREFIX}" && "${tag}" =~ ^[0-9a-f]{12}$ ]] || {
      echo "ERROR: the previous maintenance image is missing/mismatched and registry recovery is unavailable." >&2
      return 1
    }
    echo "==> [rollback] Re-pulling verified maintenance release ${tag}..."
    bash "${SCRIPT_DIR}/pull-release-images.sh" "${tag}" || return 1
    actual="$(docker image inspect "${image}" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
    [[ "${actual}" == "${expected_sha}" ]] || {
      echo "ERROR: recovered maintenance image revision '${actual}' != '${expected_sha}'." >&2
      return 1
    }
  fi

  # IMAGE_TAG is set for the command rather than relied on from .env because the
  # container reads it as an env var as well: the log-shipping canary stamps it
  # on every line it ships, so a stale value would attribute an off-box logging
  # gap to the wrong release.
  IMAGE_TAG="${tag}" "${BASE_COMPOSE[@]}" up -d --no-build --no-deps maintenance || return 1

  # `up -d` returns when the container is STARTED, which is not the same as the
  # worker running. If crond exits immediately after start -- a bad image, a
  # broken crontab, a missing mount -- the detached call still succeeds and the
  # rollback would report the worker moved while backups are silently offline.
  # That is the same assumption this whole change exists to remove: a container
  # that started is not a container running cron, exactly as a dump that exists
  # is not a dump that restores. An unhealthy worker routes to the partial
  # rollback instead of being reported as a clean one.
  #
  # This waits after traffic is already restored and smoke has passed, so it
  # costs the outage nothing; it only delays the script's exit.
  wait_healthy wizer-signage-maintenance 'maintenance worker' || return 1
}

if [[ "${TARGET_SLOT}" == "legacy" ]]; then
  echo "==> [rollback] Targeting pre-blue/green legacy containers (${TARGET_TAG:-unknown})."
  docker start wizer-signage-api wizer-signage-dashboard >/dev/null
  wait_healthy wizer-signage-api 'legacy API'
  wait_healthy wizer-signage-dashboard 'legacy dashboard'
  TARGET_API=api
  TARGET_DASHBOARD=dashboard
else
  [[ "${TARGET_SLOT}" == "blue" || "${TARGET_SLOT}" == "green" ]] || {
    echo "ERROR: invalid target slot '${TARGET_SLOT}' in history." >&2; exit 1;
  }
  ensure_slot_image api "${TARGET_SLOT}" "${TARGET_TAG}" "${TARGET_SHA}"
  ensure_slot_image dashboard "${TARGET_SLOT}" "${TARGET_TAG}" "${TARGET_SHA}"
  "${SLOTS_COMPOSE[@]}" up -d --no-build --no-deps "api_${TARGET_SLOT}" "dashboard_${TARGET_SLOT}"
  wait_healthy "wizer-signage-api-${TARGET_SLOT}" "API ${TARGET_SLOT}"
  wait_healthy "wizer-signage-dashboard-${TARGET_SLOT}" "dashboard ${TARGET_SLOT}"
  TARGET_API="api-${TARGET_SLOT}"
  TARGET_DASHBOARD="dashboard-${TARGET_SLOT}"
fi

TARGET_UPSTREAMS="$(cat <<EOF
# ROLLBACK target ${TARGET_TAG:-legacy} (${TARGET_SHA:-unknown}); switched $(date -u +%Y-%m-%dT%H:%M:%SZ)
upstream api_upstream {
    server ${TARGET_API}:3001;
    keepalive 32;
}
upstream dashboard_upstream {
    server ${TARGET_DASHBOARD}:3000;
    keepalive 32;
}
upstream dashboard_static_upstream {
    server ${TARGET_DASHBOARD}:3000;
    server ${CURRENT_DASHBOARD}:3000 backup;
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
  docker exec wizer-signage-nginx nginx -s reload || {
    docker exec wizer-signage-nginx sh -c "mv ${ACTIVE_FILE}.previous ${ACTIVE_FILE}" || true
    docker exec wizer-signage-nginx nginx -t >/dev/null 2>&1 && docker exec wizer-signage-nginx nginx -s reload >/dev/null 2>&1 || true
    return 1
  }
}

echo "==> [rollback] Switching traffic from ${CURRENT_SLOT}/${CURRENT_TAG:-unknown} to ${TARGET_SLOT}/${TARGET_TAG:-legacy}..."
write_and_reload "${TARGET_UPSTREAMS}" || { echo "ERROR: nginx refused rollback config; current traffic retained." >&2; exit 1; }

attempt=1
until curl -fsS "${PUBLIC_HEALTH_URL}" >/dev/null 2>&1; do
  if (( attempt >= HEALTH_RETRIES )); then
    echo "ERROR: rollback target failed public readiness; restoring original traffic." >&2
    write_and_reload "${OLD_UPSTREAMS}" || true
    exit 1
  fi
  sleep "${HEALTH_INTERVAL}"
  attempt=$(( attempt + 1 ))
done

if [[ "${SKIP_SMOKE:-0}" != "1" ]] && ! bash "${SCRIPT_DIR}/smoke-test.sh" "${SMOKE_URL}"; then
  echo "ERROR: rollback target failed smoke; restoring original traffic." >&2
  write_and_reload "${OLD_UPSTREAMS}" || true
  exit 1
fi

# Only once the rollback target is publicly healthy, mirroring the order
# deploy-blue-green.sh uses: never move the backup worker onto a release the
# public gates have not just accepted.
echo "==> [rollback] Returning maintenance worker to ${TARGET_TAG:-the pre-blue/green release}..."
MAINTENANCE_RESTORED=1
restore_maintenance_worker "${TARGET_TAG}" "${TARGET_SHA}" || MAINTENANCE_RESTORED=0

# Keep the just-replaced dashboard as static backup. Stop only its API after
# graceful old-worker drainage; it can be restarted again from the slot tag.
if (( API_DRAIN_SECONDS > 0 )); then sleep "${API_DRAIN_SECONDS}"; fi
if [[ "${CURRENT_SLOT}" == "blue" || "${CURRENT_SLOT}" == "green" ]]; then
  "${SLOTS_COMPOSE[@]}" stop "api_${CURRENT_SLOT}" >/dev/null 2>&1 || true
fi

printf '%s ROLLBACK from=%s/%s to=%s/%s targetSha=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${CURRENT_SLOT}" "${CURRENT_TAG:-unknown}" \
  "${TARGET_SLOT}" "${TARGET_TAG:-legacy}" "${TARGET_SHA:-unknown}" >> "${ROLLBACK_HISTORY}"

if (( MAINTENANCE_RESTORED == 0 )); then
  # Traffic is correct, so this is deliberately not reported as a failed
  # rollback. It is not reported as a clean one either: the operator is left with
  # a backup worker running a release just judged bad, and a zero exit there is
  # exactly the silent success this repository has already been bitten by.
  echo "ERROR: PARTIAL ROLLBACK." >&2
  echo "       Traffic IS restored to ${TARGET_SLOT}/${TARGET_TAG:-legacy}." >&2
  echo "       The maintenance worker is NOT, so tonight's backup, the TLS expiry check" >&2
  echo "       and the log-shipping canary still run the rolled-back release." >&2
  echo "       Return it to a known-good release before the next backup window:" >&2
  echo "         scripts/pull-release-images.sh <release-tag>" >&2
  echo "         IMAGE_TAG=<release-tag> docker compose --env-file ${ENV_FILE} \\" >&2
  echo "           -f ${BASE} -f ${PROXY} -f ${LOGGING} up -d --no-build --no-deps maintenance" >&2
  exit 1
fi

echo "==> [rollback] SUCCESS — traffic now serves ${TARGET_SLOT}/${TARGET_TAG:-legacy}; maintenance worker moved with it."
