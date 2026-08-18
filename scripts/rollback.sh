#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — Roll back to a previously-deployed image tag
# =============================================================================
# Brings the stack back up on an EARLIER set of images, without rebuilding.
#
# Why this exists: images used to be tagged only `:latest`, so every build
# discarded the name of the release it replaced. The previous version still
# existed on disk as an anonymous layer set, but nothing could address it —
# recovering from a bad deploy meant rebuilding an old commit, which needs a
# working network and several minutes, during an outage. scripts/deploy.sh now
# tags every build with its commit SHA and records the tag only after the health
# check passes, so the last KNOWN-GOOD release is always a named local image.
#
# WHAT THIS DOES NOT DO — read this before using it:
#   Database migrations are FORWARD-ONLY. Rolling the code back does NOT undo a
#   migration. If the deploy you are reverting added a column the old code does
#   not know about, that is harmless. If it DROPPED or RENAMED something the old
#   code still reads, the old code will fail — restore the pre-migration backup
#   (scripts/restore-db.sh) instead. deploy.sh takes one immediately before
#   every migration for exactly this case.
#
# USAGE:
#   scripts/rollback.sh                 # roll back to the previous release
#   scripts/rollback.sh <image-tag>     # roll back to a specific tag
#   scripts/rollback.sh --list          # show the deploy history
#
# Exit codes: 0 = rolled back and healthy, 1 = refused or failed.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.yml"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"
DEPLOY_STATE="${DEPLOY_STATE:-${ROOT_DIR}/.deploy-history}"
SERVICES=(api dashboard maintenance)

HEALTH_URL="${HEALTH_URL:-http://localhost/api/health/ready}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} not found." >&2
  exit 1
fi
COMPOSE="docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE}"

# --- History -----------------------------------------------------------------
if [[ ! -f "${DEPLOY_STATE}" ]]; then
  echo "ERROR: no deploy history at ${DEPLOY_STATE}." >&2
  echo "       Nothing has been deployed by scripts/deploy.sh on this host yet," >&2
  echo "       so there is no recorded known-good tag to return to." >&2
  echo "       Pass an explicit tag if you know one: scripts/rollback.sh <tag>" >&2
  exit 1
fi

if [[ "${1:-}" == "--list" ]]; then
  echo "Deploy history (oldest first) — ${DEPLOY_STATE}:"
  cat "${DEPLOY_STATE}"
  exit 0
fi

# --- Choose the target tag ---------------------------------------------------
# History lines are: <utc-timestamp> <tag> <note>
#   note = the full commit sha (a deploy), "rollback" (this tag was rolled TO),
#          or "rolled-back" (this tag was rolled AWAY FROM because it was bad).
#
# Naively taking the second-from-last line is wrong the moment you roll back
# twice: after [A, B, A] it would pick B — the release you just escaped. Tags
# that have been rolled away from are therefore recorded and skipped, so a
# repeated rollback steps genuinely further back or stops and says so.
#
# The "rolled-back" mark is superseded by a later DEPLOY of the same tag. History
# is read oldest-first, so a deploy line after the mark means the operator shipped
# that release again and the mark no longer describes reality — if it fails once
# more, the next rollback simply re-marks it. Without this the mark is permanent
# and unfalsifiable, which is wrong whenever the original outage was environmental
# rather than in the code. A "rollback" note is a one-off operator override
# (an explicit tag argument), not evidence of health, so it clears nothing.
CURRENT_TAG="$(tail -n 1 "${DEPLOY_STATE}" | awk '{print $2}')"

if [[ -n "${1:-}" ]]; then
  TARGET_TAG="$1"
else
  TARGET_TAG="$(
    awk -v current="${CURRENT_TAG}" '
      {
        tag[NR] = $2
        if ($3 == "rolled-back")   { bad[$2] = 1 }
        else if ($3 != "" && $3 != "rollback") { delete bad[$2] }
      }
      END {
        for (i = NR; i >= 1; i--) {
          if (tag[i] == current) continue
          if (tag[i] in bad) continue
          print tag[i]
          exit
        }
      }
    ' "${DEPLOY_STATE}"
  )"
  if [[ -z "${TARGET_TAG}" ]]; then
    echo "ERROR: no earlier known-good release to roll back to (current: ${CURRENT_TAG:-none})." >&2
    echo "       Every other recorded release has already been rolled back from." >&2
    echo "       Pass an explicit tag, or restore from backup if the current release is broken." >&2
    exit 1
  fi
fi

# --- Verify the images are actually here -------------------------------------
# Refuse BEFORE stopping anything: a rollback that takes the stack down and then
# discovers the old images were pruned is strictly worse than no rollback.
missing=()
for svc in "${SERVICES[@]}"; do
  if ! docker image inspect "wizer-signage/${svc}:${TARGET_TAG}" >/dev/null 2>&1; then
    missing+=("wizer-signage/${svc}:${TARGET_TAG}")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "ERROR: these images are not present on this host:" >&2
  printf '         %s\n' "${missing[@]}" >&2
  echo "       They were probably removed by \`docker image prune\`." >&2
  echo "       Roll back by checking out that commit and running scripts/deploy.sh." >&2
  exit 1
fi

echo "==> [rollback] Rolling back to ${TARGET_TAG} ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
echo "==> [rollback] REMINDER: migrations are forward-only and are NOT reverted."

# --- Bring the stack up on the old images ------------------------------------
export IMAGE_TAG="${TARGET_TAG}"
# --no-build: the whole point is to use what is already on disk. A build here
# would defeat the purpose and could fail for the same reason the deploy did.
${COMPOSE} up -d --no-build

# nginx caches upstream container IPs from startup; `up -d` recreates those
# containers with new IPs, so without this it proxies to dead addresses (502).
echo "==> [rollback] Restarting nginx (re-resolve upstream IPs)..."
${COMPOSE} restart nginx

# --- Health check ------------------------------------------------------------
echo "==> [rollback] Waiting for API health at ${HEALTH_URL} ..."
attempt=1
until curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; do
  if (( attempt >= HEALTH_RETRIES )); then
    echo "==> [rollback] FAILED — API did not become healthy after $(( HEALTH_RETRIES * HEALTH_INTERVAL ))s." >&2
    echo "==> [rollback] The rolled-back code may be incompatible with the current database schema." >&2
    echo "==> [rollback] Recent api logs:" >&2
    ${COMPOSE} logs --tail=50 api >&2 || true
    exit 1
  fi
  echo "    [rollback] not ready yet (attempt ${attempt}/${HEALTH_RETRIES}); retrying in ${HEALTH_INTERVAL}s..."
  attempt=$(( attempt + 1 ))
  sleep "${HEALTH_INTERVAL}"
done

# Record BOTH facts: the tag we escaped is marked bad so a second rollback does
# not bounce straight back into it, and the tag now running becomes current.
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ -n "${CURRENT_TAG}" && "${CURRENT_TAG}" != "${TARGET_TAG}" ]]; then
  printf '%s %s %s\n' "${now}" "${CURRENT_TAG}" "rolled-back" >> "${DEPLOY_STATE}"
fi
printf '%s %s %s\n' "${now}" "${TARGET_TAG}" "rollback" >> "${DEPLOY_STATE}"

echo "==> [rollback] API is healthy on ${TARGET_TAG}."
${COMPOSE} ps
echo "==> [rollback] Complete ($(date -u +%Y-%m-%dT%H:%M:%SZ))."
