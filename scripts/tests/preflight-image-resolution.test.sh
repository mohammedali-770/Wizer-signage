#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — production-preflight.sh maintenance-image resolution
# =============================================================================
# Preflight gates a deploy by inspecting the maintenance image. WHICH image it
# picks decides whether the gate is meaningful: resolving the running container
# while a new release is being deployed measures the image being REPLACED, so a
# release that changes anything preflight checks blocks itself. That happened in
# production on 2026-09-09 — the host PostgreSQL client moved to 17 to match the
# 17.6 server, and preflight resolved the old 16 image and refused the deploy.
#
# The function is EXTRACTED FROM THE SCRIPT rather than copied here, so these
# cases exercise the shipped code and cannot drift from it.
#
# Usage:  bash scripts/tests/preflight-image-resolution.test.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PREFLIGHT="${ROOT_DIR}/scripts/production-preflight.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

pass=0; fail=0
ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         $2"; fail=$(( fail + 1 )); }

# --- Extract the real function ----------------------------------------------
FN="$(sed -n '/^resolve_maintenance_image() {/,/^}/p' "${PREFLIGHT}")"
[[ -n "${FN}" ]] || { echo "could not extract resolve_maintenance_image from ${PREFLIGHT}" >&2; exit 1; }
eval "${FN}"

# --- docker stub -------------------------------------------------------------
# STUB_IMAGES  — space-separated image refs that exist locally
# STUB_RUNNING — image of the running maintenance container ("" = not running)
cat > "${WORK}/docker" <<'STUB'
#!/usr/bin/env bash
case "$1 $2" in
  "image inspect")
    for present in ${STUB_IMAGES:-}; do [[ "$3" == "${present}" ]] && exit 0; done
    exit 1 ;;
  "inspect -f")
    [[ -n "${STUB_RUNNING:-}" ]] || exit 1
    printf '%s\n' "${STUB_RUNNING}"; exit 0 ;;
esac
exit 1
STUB
chmod +x "${WORK}/docker"
PATH="${WORK}:${PATH}"

REGISTRY="ghcr.io/acme"
FULL_SHA="aed5947a7a1c3204f7f57de92d95d29a2138dadd"
SHORT="aed5947a7a1c"
OLD="wizer-signage/maintenance:3b61952f4dd0"

# run <expected-rc> <expected-stdout> <arg...>
run() {
  local want_rc="$1" want_out="$2"; shift 2
  local out rc
  out="$(resolve_maintenance_image "$@" 2>/dev/null)"; rc=$?
  RESULT_RC="${rc}"; RESULT_OUT="${out}"
  [[ "${rc}" == "${want_rc}" && "${out}" == "${want_out}" ]]
}

echo "=== production-preflight.sh image resolution ==="

# --- 1. THE REGRESSION -------------------------------------------------------
# A named release that is present must win over a DIFFERENT running container.
# Before the fix this returned the running image and the gate measured the wrong
# release; the deploy that fixed the mismatch was blocked by the mismatch.
STUB_IMAGES="wizer-signage/maintenance:${SHORT}" STUB_RUNNING="${OLD}" \
  run 0 "wizer-signage/maintenance:${SHORT}" "${FULL_SHA}" \
  && ok "prefers the named release over a different running container" \
  || no "prefers the named release over a different running container" "rc=${RESULT_RC} out=${RESULT_OUT}"

# --- 2. The 40 -> 12 character normalisation --------------------------------
# deploy-production.sh passes the full SHA; images carry the 12-char prefix. The
# old code looked up the 40-char tag, which never existed.
STUB_IMAGES="${REGISTRY}/wizer-signage-maintenance:${SHORT}" STUB_RUNNING="" \
  run 0 "${REGISTRY}/wizer-signage-maintenance:${SHORT}" "${FULL_SHA}" \
  && ok "normalises a 40-character SHA to the 12-character image tag" \
  || no "normalises a 40-character SHA to the 12-character image tag" "rc=${RESULT_RC} out=${RESULT_OUT}"

# --- 3. A 12-character tag is accepted as-is --------------------------------
STUB_IMAGES="wizer-signage/maintenance:${SHORT}" STUB_RUNNING="" \
  run 0 "wizer-signage/maintenance:${SHORT}" "${SHORT}" \
  && ok "accepts an already-short release tag" \
  || no "accepts an already-short release tag" "rc=${RESULT_RC} out=${RESULT_OUT}"

# --- 4. Named but absent must FAIL, never fall back -------------------------
# Falling back to the running container or :latest is the whole defect: it
# validates some other image and reports a pass.
STUB_IMAGES="${OLD} wizer-signage/maintenance:latest" STUB_RUNNING="${OLD}" \
  run 2 "" "${FULL_SHA}" \
  && ok "fails with rc=2 when the named release is not on the host" \
  || no "fails with rc=2 when the named release is not on the host" "rc=${RESULT_RC} out=${RESULT_OUT}"

# --- 5. No release named: audit the running container -----------------------
# A bare preflight run is a steady-state audit, and the running container is
# what takes tonight's backup, so it is the correct subject there.
STUB_IMAGES="wizer-signage/maintenance:latest" STUB_RUNNING="${OLD}" \
  run 0 "${OLD}" "" \
  && ok "audits the running container when no release is named" \
  || no "audits the running container when no release is named" "rc=${RESULT_RC} out=${RESULT_OUT}"

# --- 6. No release named, nothing running: fall back to :latest -------------
STUB_IMAGES="wizer-signage/maintenance:latest" STUB_RUNNING="" \
  run 0 "wizer-signage/maintenance:latest" "" \
  && ok "falls back to :latest only when nothing is named or running" \
  || no "falls back to :latest only when nothing is named or running" "rc=${RESULT_RC} out=${RESULT_OUT}"

# --- 7. Nothing at all ------------------------------------------------------
STUB_IMAGES="" STUB_RUNNING="" \
  run 1 "" "" \
  && ok "reports rc=1 when nothing is resolvable at all" \
  || no "reports rc=1 when nothing is resolvable at all" "rc=${RESULT_RC} out=${RESULT_OUT}"

# --- 8. IMAGE_TAG is honoured when no argument is given ---------------------
IMAGE_TAG="${SHORT}" STUB_IMAGES="wizer-signage/maintenance:${SHORT}" STUB_RUNNING="${OLD}" \
  run 0 "wizer-signage/maintenance:${SHORT}" "" \
  && ok "honours IMAGE_TAG when no argument is passed" \
  || no "honours IMAGE_TAG when no argument is passed" "rc=${RESULT_RC} out=${RESULT_OUT}"

echo
echo "=== ${pass} passed, ${fail} failed ==="
(( fail == 0 ))
