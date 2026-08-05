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
#
# READINESS, not liveness: /api/health returns {status:'ok'} from process.uptime()
# and never touches the database, so a deploy that breaks DB connectivity would
# print "API is healthy" while every request 500s. /api/health/ready runs a real
# SELECT 1 and returns 503 when the database is unreachable.
HEALTH_URL="${HEALTH_URL:-http://localhost/api/health/ready}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"

# Git branch to deploy.
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

# Where the deploy history is recorded, newest LAST. scripts/rollback.sh reads
# it to find the previously-good image tag.
DEPLOY_STATE="${DEPLOY_STATE:-${ROOT_DIR}/.deploy-history}"
DEPLOY_HISTORY_KEEP="${DEPLOY_HISTORY_KEEP:-20}"

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
# Tag by commit SHA, not just :latest.
#
# With only :latest, every build DISCARDS the tag of the image it replaces —
# the previous build becomes a dangling layer set with no name, so there is
# nothing to roll back TO. Recovering meant rebuilding the old commit, which
# needs a working network, a working registry, and several minutes, during an
# outage. A SHA tag makes the previous release a named artifact that is already
# on the disk.
IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
export IMAGE_TAG
echo "==> [deploy] Building service images (tag: ${IMAGE_TAG})..."
${COMPOSE} build

# Also move :latest so an operator running plain `docker compose up` without
# IMAGE_TAG still gets this release.
for svc in api dashboard maintenance; do
  docker tag "wizer-signage/${svc}:${IMAGE_TAG}" "wizer-signage/${svc}:latest"
done

# --- 3. Pre-migration backup -------------------------------------------------
# Migrations are forward-only and can be destructive. Without a recovery point
# taken immediately before them, the closest restore is the nightly cron — i.e.
# up to 24h of every tenant's data. This is a HARD gate: if the backup fails we
# do not migrate.
#
# Set DEPLOY_SKIP_BACKUP=1 only for a deliberate, migration-free redeploy.
if [[ "${DEPLOY_SKIP_BACKUP:-0}" == "1" ]]; then
  echo "==> [deploy] WARNING: skipping the pre-migration backup (DEPLOY_SKIP_BACKUP=1)." >&2
else
  echo "==> [deploy] Taking a pre-migration database backup..."
  if ! bash "${ROOT_DIR}/scripts/backup-db.sh"; then
    echo "==> [deploy] FAILED — pre-migration backup did not succeed; refusing to migrate." >&2
    echo "==> [deploy] Fix the backup, or re-run with DEPLOY_SKIP_BACKUP=1 to override." >&2
    exit 1
  fi
fi

# --- 4. Apply database migrations --------------------------------------------
# The migration files are baked into the freshly-built api image above, so this
# must run AFTER build and BEFORE bringing the stack up. Idempotent.
echo "==> [deploy] Applying database migrations (prisma migrate deploy)..."
${COMPOSE} run --rm api npx prisma migrate deploy

# --- 5. Bring the stack up ---------------------------------------------------
echo "==> [deploy] Starting stack (docker compose up -d)..."
${COMPOSE} up -d

# --- 6. Reload nginx so it re-resolves the recreated upstreams ---------------
# nginx resolves the `dashboard`/`api` upstream hostnames once at startup and
# caches their container IPs. `up -d` recreates those containers with NEW IPs,
# so a long-running nginx keeps proxying to the dead IPs and returns 502 Bad
# Gateway. Re-resolution is mandatory after recreating upstreams.
#
# RELOAD, not restart. `restart` stops the container: every connection it is
# holding dies mid-flight, which on this platform means in-progress content
# uploads (up to 300 MB, minutes long over a venue's uplink) fail and have to be
# started over. A reload starts new workers on the new config while the old
# workers finish the requests they are already serving, so nothing in flight is
# dropped.
#
# `nginx -t` first: a reload with a broken config leaves the OLD config running
# and returns non-zero, which would otherwise be indistinguishable from a
# working deploy until the next restart picked up the broken file.
echo "==> [deploy] Reloading nginx (re-resolve upstream IPs)..."
if ${COMPOSE} exec -T nginx nginx -t && ${COMPOSE} exec -T nginx nginx -s reload; then
  echo "    [deploy] nginx reloaded gracefully."
else
  # Falls back rather than aborting: an unreloadable nginx (not yet running,
  # exec unavailable) must not strand the stack on stale upstream IPs — every
  # request would 502 until an operator intervened. The restart drops in-flight
  # connections, which is why it is the fallback and not the default.
  echo "==> [deploy] WARNING: graceful reload failed; falling back to restart." >&2
  ${COMPOSE} restart nginx
fi

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

# --- 8. Record the release -----------------------------------------------------
# Written only AFTER the health check passes, so the history contains releases
# that actually served traffic — rolling back to a tag that never came up would
# be worse than not rolling back at all.
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${IMAGE_TAG}" "$(git rev-parse HEAD)" \
  >> "${DEPLOY_STATE}"
# Keep the file bounded; images older than this are pruned by docker anyway.
if [[ "$(wc -l < "${DEPLOY_STATE}")" -gt "${DEPLOY_HISTORY_KEEP}" ]]; then
  tail -n "${DEPLOY_HISTORY_KEEP}" "${DEPLOY_STATE}" > "${DEPLOY_STATE}.tmp"
  mv "${DEPLOY_STATE}.tmp" "${DEPLOY_STATE}"
fi

# --- 9. Smoke test -------------------------------------------------------------
# The readiness poll above proves the API can reach its database. It proves
# nothing about nginx's routing, the security headers, the correlation-ID chain,
# or the global validation pipe — a release can satisfy /ready and still be
# broken in every way a user would notice.
#
# Deliberately AFTER the release is recorded. rollback.sh reads the last history
# line as "currently running" and steps back from there; if a failed release
# were omitted, the last line would be the PREVIOUS good one and a rollback
# would skip past it to the release before. Recording first keeps that stepping
# correct, and rollback.sh marks this tag `rolled-back` when the operator
# escapes it, so it is never selected again.
SMOKE_SCRIPT="${ROOT_DIR}/scripts/smoke-test.sh"
if [[ "${SKIP_SMOKE:-0}" == "1" ]]; then
  echo "==> [deploy] Smoke test SKIPPED (SKIP_SMOKE=1)."
elif [[ ! -x "${SMOKE_SCRIPT}" ]]; then
  echo "==> [deploy] WARNING: ${SMOKE_SCRIPT} missing or not executable — skipping." >&2
else
  # Prefer the public URL so the run also covers TLS, HSTS and the redirect;
  # those checks skip over plain http. APP_DOMAIN comes from the same .env the
  # stack was brought up with.
  APP_DOMAIN_VALUE="$(grep -E '^APP_DOMAIN=' "${ENV_FILE}" | tail -1 | cut -d= -f2- | tr -d '"'"'"'\r' | xargs || true)"
  SMOKE_URL="${SMOKE_URL:-${APP_DOMAIN_VALUE:+https://${APP_DOMAIN_VALUE}}}"
  SMOKE_URL="${SMOKE_URL:-http://localhost}"

  echo "==> [deploy] Smoke testing ${SMOKE_URL} ..."
  if bash "${SMOKE_SCRIPT}" "${SMOKE_URL}"; then
    echo "==> [deploy] Smoke test passed."
  else
    echo "==> [deploy] FAILED — the stack is up but the smoke test did not pass." >&2
    echo "==> [deploy] ${IMAGE_TAG} is serving traffic and is recorded as the current release." >&2
    echo "==> [deploy] Roll back now:  scripts/rollback.sh" >&2
    echo "==> [deploy] (Re-run this deploy with SKIP_SMOKE=1 only if you have decided" >&2
    echo "==> [deploy]  the failing checks are acceptable.)" >&2
    exit 1
  fi
fi

echo "==> [deploy] Current services:"
${COMPOSE} ps

echo "==> [deploy] Deployed ${IMAGE_TAG}. Roll back with: scripts/rollback.sh"
echo "==> [deploy] Deploy complete ($(date -u +%Y-%m-%dT%H:%M:%SZ))."
