#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — production deploy from immutable registry images
# =============================================================================
# Preferred production path once the host has read-only registry auth.
#
# Unlike scripts/deploy.sh, this script NEVER builds application images on the
# production host. It pulls the exact 12-character commit-SHA release published
# by .github/workflows/release-images.yml, verifies each image's embedded full
# Git revision, retags it into the canonical local names used by Compose and the
# existing rollback script, then performs the same backup/migrate/health/smoke
# gates as the local-build deploy.
#
# One-time host setup for a private GHCR repository:
#   docker login ghcr.io
#   # Put IMAGE_REGISTRY_PREFIX=ghcr.io/<owner> in repo-root .env, or export it.
#
# Usage:
#   scripts/deploy-release.sh
#
# Optional overrides are the same as deploy.sh where applicable:
#   DEPLOY_BRANCH, HEALTH_URL, HEALTH_RETRIES, HEALTH_INTERVAL,
#   DEPLOY_SKIP_BACKUP, SKIP_SMOKE, SMOKE_URL, DEPLOY_STATE.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.yml"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} not found. Copy .env.example to .env and fill production values." >&2
  exit 1
fi

COMPOSE="docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-http://localhost/api/health/ready}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
DEPLOY_STATE="${DEPLOY_STATE:-${ROOT_DIR}/.deploy-history}"
DEPLOY_HISTORY_KEEP="${DEPLOY_HISTORY_KEEP:-20}"

read_env_value() {
  local key="$1"
  grep -E "^${key}=" "${ENV_FILE}" 2>/dev/null \
    | tail -1 \
    | cut -d= -f2- \
    | tr -d '"'"'"'\r' \
    | xargs || true
}

IMAGE_REGISTRY_PREFIX="${IMAGE_REGISTRY_PREFIX:-$(read_env_value IMAGE_REGISTRY_PREFIX)}"
if [[ -z "${IMAGE_REGISTRY_PREFIX}" ]]; then
  echo "ERROR: IMAGE_REGISTRY_PREFIX is required for registry deployment." >&2
  echo "       Example: IMAGE_REGISTRY_PREFIX=ghcr.io/<owner>" >&2
  exit 1
fi
export IMAGE_REGISTRY_PREFIX

cd "${ROOT_DIR}"
echo "==> [release] Wizer Signage registry deploy starting ($(date -u +%Y-%m-%dT%H:%M:%SZ))"

# --- 1. Resolve the exact code/release identity ------------------------------
echo "==> [release] Pulling latest origin/${DEPLOY_BRANCH} metadata..."
git fetch --prune origin
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only origin "${DEPLOY_BRANCH}"

IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
FULL_SHA="$(git rev-parse HEAD)"
if [[ ! "${IMAGE_TAG}" =~ ^[0-9a-f]{12}$ || ! "${FULL_SHA}" =~ ^${IMAGE_TAG}[0-9a-f]{28}$ ]]; then
  echo "ERROR: could not resolve a canonical git release identity." >&2
  exit 1
fi
export IMAGE_TAG

echo "==> [release] Target commit ${FULL_SHA} (tag ${IMAGE_TAG})"

# --- 2. Pull and verify immutable release images -----------------------------
# pull-release-images.sh verifies the OCI revision label before creating the
# canonical local tags. A missing private-registry login or missing release
# therefore fails BEFORE backup/migration or any running container is touched.
echo "==> [release] Pulling verified release images from ${IMAGE_REGISTRY_PREFIX} ..."
bash "${ROOT_DIR}/scripts/pull-release-images.sh" "${IMAGE_TAG}"

# --- 3. Pre-migration backup -------------------------------------------------
if [[ "${DEPLOY_SKIP_BACKUP:-0}" == "1" ]]; then
  echo "==> [release] WARNING: skipping pre-migration backup (DEPLOY_SKIP_BACKUP=1)." >&2
else
  echo "==> [release] Taking pre-migration database backup..."
  if ! bash "${ROOT_DIR}/scripts/backup-db.sh"; then
    echo "==> [release] FAILED — backup failed; refusing to migrate or replace containers." >&2
    exit 1
  fi
fi

# --- 4. Apply migrations from the exact pulled API image ---------------------
echo "==> [release] Applying database migrations from ${IMAGE_TAG} ..."
${COMPOSE} run --rm --no-deps api npx prisma migrate deploy

# --- 5. Replace services without allowing an accidental host build -----------
echo "==> [release] Starting immutable release with --no-build ..."
${COMPOSE} up -d --no-build

# --- 6. Gracefully reload nginx to pick up recreated upstream IPs ------------
echo "==> [release] Reloading nginx ..."
if ${COMPOSE} exec -T nginx nginx -t && ${COMPOSE} exec -T nginx nginx -s reload; then
  echo "    [release] nginx reloaded gracefully."
else
  echo "==> [release] WARNING: graceful reload failed; falling back to restart." >&2
  ${COMPOSE} restart nginx
fi

# --- 7. Readiness gate -------------------------------------------------------
echo "==> [release] Waiting for API readiness at ${HEALTH_URL} ..."
attempt=1
until curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; do
  if (( attempt >= HEALTH_RETRIES )); then
    echo "==> [release] FAILED — API did not become ready after $(( HEALTH_RETRIES * HEALTH_INTERVAL ))s." >&2
    ${COMPOSE} logs --tail=50 api >&2 || true
    echo "==> [release] Roll back now: scripts/rollback.sh" >&2
    exit 1
  fi
  echo "    [release] not ready (attempt ${attempt}/${HEALTH_RETRIES}); retrying in ${HEALTH_INTERVAL}s..."
  attempt=$(( attempt + 1 ))
  sleep "${HEALTH_INTERVAL}"
done

echo "==> [release] API is ready."

# --- 8. Record release identity for the existing rollback script -------------
# Record before smoke for the same reason as deploy.sh: if smoke fails, the bad
# release must be the history's current entry so rollback steps to the previous
# known-good tag rather than skipping past it.
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${IMAGE_TAG}" "${FULL_SHA}" >> "${DEPLOY_STATE}"
if [[ "$(wc -l < "${DEPLOY_STATE}")" -gt "${DEPLOY_HISTORY_KEEP}" ]]; then
  tail -n "${DEPLOY_HISTORY_KEEP}" "${DEPLOY_STATE}" > "${DEPLOY_STATE}.tmp"
  mv "${DEPLOY_STATE}.tmp" "${DEPLOY_STATE}"
fi

# --- 9. Public smoke gate ----------------------------------------------------
SMOKE_SCRIPT="${ROOT_DIR}/scripts/smoke-test.sh"
if [[ "${SKIP_SMOKE:-0}" == "1" ]]; then
  echo "==> [release] Smoke test SKIPPED (SKIP_SMOKE=1)."
elif [[ ! -x "${SMOKE_SCRIPT}" ]]; then
  echo "==> [release] WARNING: ${SMOKE_SCRIPT} missing or not executable — skipping." >&2
else
  APP_DOMAIN_VALUE="$(read_env_value APP_DOMAIN)"
  SMOKE_URL="${SMOKE_URL:-${APP_DOMAIN_VALUE:+https://${APP_DOMAIN_VALUE}}}"
  SMOKE_URL="${SMOKE_URL:-http://localhost}"

  echo "==> [release] Smoke testing ${SMOKE_URL} ..."
  if bash "${SMOKE_SCRIPT}" "${SMOKE_URL}"; then
    echo "==> [release] Smoke test passed."
  else
    echo "==> [release] FAILED — release is serving traffic but smoke did not pass." >&2
    echo "==> [release] ${IMAGE_TAG} is recorded as current; roll back: scripts/rollback.sh" >&2
    exit 1
  fi
fi

echo "==> [release] Current services:"
${COMPOSE} ps
echo "==> [release] Deployed immutable registry release ${IMAGE_TAG}."
echo "==> [release] Registry deploy complete ($(date -u +%Y-%m-%dT%H:%M:%SZ))."
