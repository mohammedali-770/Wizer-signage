#!/usr/bin/env bash
# Wizer Signage — preferred production deployment entrypoint.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET_SHA="${1:-}"
[[ "${TARGET_SHA}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ERROR [production]: usage: scripts/deploy-production.sh <FULL_40_CHAR_MAIN_SHA>" >&2
  exit 2
}
[[ $# -eq 1 ]] || {
  echo "ERROR [production]: exactly one immutable release SHA is accepted." >&2
  exit 2
}

printf '==> [production] Running mandatory host/config preflight for %s...\n' "${TARGET_SHA}"
bash "${SCRIPT_DIR}/production-preflight.sh" "${TARGET_SHA}"
printf '==> [production] Verifying bounded runtime database pools...\n'
bash "${SCRIPT_DIR}/assert-production-db-pool.sh"

printf '==> [production] Verifying protected remote main is still the accepted release...\n'
REMOTE_MAIN_SHA="$(git -C "${ROOT_DIR}" ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
[[ "${REMOTE_MAIN_SHA}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ERROR [production]: could not resolve remote protected main SHA." >&2
  exit 1
}
[[ "${REMOTE_MAIN_SHA}" == "${TARGET_SHA}" ]] || {
  echo "ERROR [production]: remote main moved after release acceptance; aborting before image pull/migration." >&2
  echo "ERROR [production]: review and accept the new main SHA before deploying." >&2
  exit 1
}
printf '  ok  protected main still equals the accepted immutable release SHA\n'

export EXPECTED_RELEASE_SHA="${TARGET_SHA}"
unset DEPLOY_SKIP_BACKUP

printf '==> [production] Preflight + immutable-main check passed; handing off to blue/green deployment...\n'
bash "${SCRIPT_DIR}/deploy-blue-green.sh"

# Only after deploy-blue-green has completed its readiness/cutover gate do we
# reclaim dangling layers left by older pulls. Tagged current/rollback release
# images are preserved. Wizer production never builds on-host, so a global
# `docker builder prune` would only delete caches that may belong to unrelated
# projects and is intentionally not part of the certified production path.
printf '==> [production] Healthy cutover confirmed; pruning dangling Docker images...\n'
docker image prune -f >/dev/null
printf '  ok  dangling Docker images pruned; tagged rollback releases preserved\n'
