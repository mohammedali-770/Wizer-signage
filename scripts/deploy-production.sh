#!/usr/bin/env bash
# Wizer Signage — preferred production deployment entrypoint.
#
# Production release policy freezes protected `main` to one accepted 40-character
# SHA. This wrapper proves the intended coordinate still equals remote main
# immediately before handing off to deploy-blue-green.sh. The blue/green script
# then fetches/pulls protected main and verifies/pulls immutable SHA-tagged images.
#
# Keep all application/container mutation in deploy-blue-green.sh. This wrapper's
# only repository operation before handoff is a read-only `git ls-remote` check.
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

# Expose the accepted identity for the blue/green script, which rechecks it after
# its own fetch/pull. Production also removes the non-production backup escape
# hatch: the mandatory pre-migration backup cannot be skipped through this path.
export EXPECTED_RELEASE_SHA="${TARGET_SHA}"
unset DEPLOY_SKIP_BACKUP

printf '==> [production] Preflight + immutable-main check passed; handing off to blue/green deployment...\n'
exec bash "${SCRIPT_DIR}/deploy-blue-green.sh"
