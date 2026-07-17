#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — Production deploy
# =============================================================================
# Deploys the latest code to the current host:
#   1. Pull latest from git.
#   2. Install workspace dependencies (pnpm).
#   3. Build service images.
#   4. Bring the stack up (detached) with the production compose file.
#   5. Poll /api/health until the API reports healthy.
#
# This script is intended to run ON the deployment host (the machine that runs
# docker). See docs/production-deployment.md for the full workflow.
#
# REQUIREMENTS:
#   - bash, git, pnpm, docker (with the compose plugin), curl
# =============================================================================

set -euo pipefail

# --- Resolve repo root relative to this script -------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.yml"
ENV_FILE="${ROOT_DIR}/.env"
# --env-file is REQUIRED: Compose v2 resolves ${VAR} interpolation (e.g. the
# nginx APP_DOMAIN and the dashboard NEXT_PUBLIC_API_URL build arg) from the
# PROJECT directory (infra/docker/), not the CWD — without this flag a repo-root
# .env is silently ignored and the stack fails or builds with wrong defaults.
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} not found. Copy .env.example to .env and fill in production values." >&2
  exit 1
fi
COMPOSE="docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE}"

# Health check endpoint (through nginx by default). Override as needed.
HEALTH_URL="${HEALTH_URL:-http://localhost/api/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"

# Git branch to deploy.
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

cd "${ROOT_DIR}"

echo "==> [deploy] Wizer Signage deploy starting ($(date -u +%Y-%m-%dT%H:%M:%SZ))"

# --- 1. Pull latest ----------------------------------------------------------
echo "==> [deploy] Pulling latest from origin/${DEPLOY_BRANCH}..."
git fetch --prune origin
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only origin "${DEPLOY_BRANCH}"

# Note: no host-side `pnpm install` — dependencies are installed INSIDE the
# Docker images during `compose build`. The host only needs git + docker + curl.

# --- 2. Build images ---------------------------------------------------------
echo "==> [deploy] Building service images..."
${COMPOSE} build

# --- 4. Apply database migrations --------------------------------------------
# The migration files are baked into the freshly-built api image above, so this
# must run AFTER build and BEFORE bringing the stack up. Idempotent.
echo "==> [deploy] Applying database migrations (prisma migrate deploy)..."
${COMPOSE} run --rm api npx prisma migrate deploy

# --- 5. Bring the stack up ---------------------------------------------------
echo "==> [deploy] Starting stack (docker compose up -d)..."
${COMPOSE} up -d

# --- 6. Restart nginx so it re-resolves the recreated upstreams --------------
# nginx resolves the `dashboard`/`api` upstream hostnames once at startup and
# caches their container IPs. `up -d` recreates those containers with NEW IPs,
# so a long-running nginx keeps proxying to the dead IPs and returns 502 Bad
# Gateway. Restarting nginx forces it to re-resolve. Always do this after
# recreating upstreams.
echo "==> [deploy] Restarting nginx (re-resolve upstream IPs)..."
${COMPOSE} restart nginx

# --- 7. Health check loop ----------------------------------------------------
echo "==> [deploy] Waiting for API health at ${HEALTH_URL} ..."
attempt=1
until curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; do
  if (( attempt >= HEALTH_RETRIES )); then
    echo "==> [deploy] FAILED — API did not become healthy after $(( HEALTH_RETRIES * HEALTH_INTERVAL ))s." >&2
    echo "==> [deploy] Recent api logs:" >&2
    ${COMPOSE} logs --tail=50 api >&2 || true
    exit 1
  fi
  echo "    [deploy] not ready yet (attempt ${attempt}/${HEALTH_RETRIES}); retrying in ${HEALTH_INTERVAL}s..."
  attempt=$(( attempt + 1 ))
  sleep "${HEALTH_INTERVAL}"
done

echo "==> [deploy] API is healthy."
echo "==> [deploy] Current services:"
${COMPOSE} ps

echo "==> [deploy] Deploy complete ($(date -u +%Y-%m-%dT%H:%M:%SZ))."
