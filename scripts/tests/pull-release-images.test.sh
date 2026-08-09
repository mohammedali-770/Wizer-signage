#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PULLER="${ROOT_DIR}/scripts/pull-release-images.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${WORK}/bin"

pass=0
fail=0
ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         $2"; fail=$(( fail + 1)); }

# Deliberately low-entropy SHA-shaped values: these test syntax/identity matching,
# not secret detection, and should not resemble API credentials to gitleaks.
TAG="000000000001"
FULL_REV="0000000000010000000000000000000000000000"
WRONG_REV="0000000000020000000000000000000000000000"

cat > "${WORK}/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${DOCKER_LOG}"
case "${1:-} ${2:-}" in
  "pull "*) exit "${PULL_RC:-0}" ;;
  "image inspect") printf '%s\n' "${IMAGE_REVISION}" ;;
  "tag "*) exit 0 ;;
esac
STUB
chmod +x "${WORK}/bin/docker"
export PATH="${WORK}/bin:${PATH}"

run_puller() {
  : > "${WORK}/docker.log"
  DOCKER_LOG="${WORK}/docker.log" \
  IMAGE_REGISTRY_PREFIX="${IMAGE_REGISTRY_PREFIX_OVERRIDE:-ghcr.io/example}" \
  IMAGE_REVISION="${IMAGE_REVISION_OVERRIDE:-${FULL_REV}}" \
  PULL_RC="${PULL_RC_OVERRIDE:-0}" \
    bash "${PULLER}" "${1:-${TAG}}" 2>&1
}

echo "=== pull-release-images.sh ==="

out="$(run_puller "${TAG}")"; rc=$?
if (( rc == 0 )) \
  && grep -q "pull ghcr.io/example/wizer-signage-api:${TAG}" "${WORK}/docker.log" \
  && grep -q "tag ghcr.io/example/wizer-signage-maintenance:${TAG} wizer-signage/maintenance:${TAG}" "${WORK}/docker.log"; then
  ok "pulls all registry images and retags them under canonical local names"
else
  no "pulls and retags a valid release" "rc=${rc} out=${out} log=$(cat "${WORK}/docker.log")"
fi

out="$(IMAGE_REVISION_OVERRIDE="${WRONG_REV}" run_puller "${TAG}")"; rc=$?
if (( rc != 0 )) && [[ "${out}" == *"Refusing to retag or deploy"* ]] \
  && ! grep -q '^tag ' "${WORK}/docker.log"; then
  ok "refuses an image whose embedded git revision does not match the requested tag"
else
  no "refuses a revision mismatch before retagging" "rc=${rc} out=${out} log=$(cat "${WORK}/docker.log")"
fi

out="$(run_puller not-a-sha)"; rc=$?
if (( rc == 2 )) && [[ "${out}" == *"12 lowercase hexadecimal"* ]]; then
  ok "rejects malformed release tags before calling docker"
else
  no "rejects malformed release tags" "rc=${rc} out=${out}"
fi

out="$(IMAGE_REGISTRY_PREFIX_OVERRIDE='https://ghcr.io/example' run_puller "${TAG}")"; rc=$?
if (( rc == 2 )) && [[ "${out}" == *"without scheme"* ]]; then
  ok "rejects URL-shaped registry prefixes"
else
  no "rejects URL-shaped registry prefixes" "rc=${rc} out=${out}"
fi

out="$(PULL_RC_OVERRIDE=1 run_puller "${TAG}")"; rc=$?
if (( rc != 0 )) && ! grep -q '^tag ' "${WORK}/docker.log"; then
  ok "fails closed when a registry pull fails"
else
  no "fails closed on registry pull failure" "rc=${rc} out=${out} log=$(cat "${WORK}/docker.log")"
fi

echo
echo "=== ${pass} passed, ${fail} failed ==="
(( fail == 0 ))
