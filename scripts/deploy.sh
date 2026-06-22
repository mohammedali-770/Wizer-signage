#!/usr/bin/env bash
# =============================================================================
# MasterSignage — Production deploy
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
COMPOSE="docker compose -f ${COMPOSE_FILE}"

# Health check endpoint (through nginx by default). Override as needed.
HEALTH_URL="${HEALTH_URL:-http://localhost/api/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"

# Git branch to deploy.
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

cd "${ROOT_DIR}"

echo "==> [deploy] MasterSignage deploy starting ($(date -u +%Y-%m-%dT%H:%M:%SZ))"

# --- 1. Pull latest ----------------------------------------------------------
echo "==> [deploy] Pulling latest from origin/${DEPLOY_BRANCH}..."
git fetch --prune origin
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only origin "${DEPLOY_BRANCH}"

# --- 2. Install dependencies -------------------------------------------------
echo "==> [deploy] Installing dependencies (pnpm install --frozen-lockfile)..."
pnpm install --frozen-lockfile

# --- 3. Build images ---------------------------------------------------------
echo "==> [deploy] Building service images..."
${COMPOSE} build

# --- 4. Bring the stack up ---------------------------------------------------
echo "==> [deploy] Starting stack (docker compose up -d)..."
${COMPOSE} up -d

# --- 5. Health check loop ----------------------------------------------------
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
