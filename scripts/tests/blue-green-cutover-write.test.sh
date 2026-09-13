#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — deploy-blue-green.sh write_and_reload failure handling
# =============================================================================
# write_and_reload is ALWAYS called in a condition context (`if ! write_and_reload
# ...`). Bash suppresses `set -e` for the entire body of a function invoked that
# way, so any unchecked command inside it can fail and execution simply
# continues to `return 0` -- reporting a successful cutover.
#
# Combined with a stale ${ACTIVE_FILE}.next from an earlier failed run, that is
# a SILENT WRONG-SLOT CUTOVER: the stale file is promoted, `nginx -t` passes
# because it is valid config for the wrong slot, the reload succeeds, and the
# public readiness gate then confirms the OLD slot is healthy. Every signal the
# deploy has says green while traffic never moved.
#
# docker is stubbed with a directory standing in for the container filesystem,
# so these exercise the real shipped function.
#
# Usage:  bash scripts/tests/blue-green-cutover-write.test.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEPLOY="${ROOT_DIR}/scripts/deploy-blue-green.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

pass=0; fail=0
ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         $2"; fail=$(( fail + 1 )); }

echo "==> deploy-blue-green.sh write_and_reload"

body="$(sed -n '/^write_and_reload() {/,/^}/p' "${DEPLOY}")"
[[ -n "${body}" ]] || { echo "could not extract write_and_reload from ${DEPLOY}" >&2; exit 1; }

# --- Harness -----------------------------------------------------------------
# CFS stands in for the container filesystem. The docker stub honours the few
# shapes write_and_reload uses and fails whichever one the case is probing.
CFS="${WORK}/cfs"
ACTIVE_FILE="${CFS}/active-upstreams.conf"

reset_container() {
  rm -rf "${CFS}"; mkdir -p "${CFS}"
  printf 'upstream api_upstream { server OLD:3000; }\n' > "${ACTIVE_FILE}"
  FAIL_WRITE=0; FAIL_PROMOTE=0; FAIL_RMNEXT=0; FAIL_NGINX_T=0; SHORT_WRITE=0
  RELOADED=0
}

docker() {
  # docker exec [-i] wizer-signage-nginx (sh -c "<cmd>" | nginx -t | nginx -s reload)
  local cmd
  shift                      # exec
  [[ "${1:-}" == "-i" ]] && shift
  shift                      # container name
  if [[ "${1:-}" == "nginx" ]]; then
    case "${2:-}" in
      -t) return "${FAIL_NGINX_T}" ;;
      -s) RELOADED=1; return 0 ;;
    esac
    return 0
  fi
  shift; shift               # sh -c
  cmd="${1:-}"
  case "${cmd}" in
    rm\ -f*next*)  return "${FAIL_RMNEXT}" ;;
    cat\ \>*next*)
      (( FAIL_WRITE )) && return 1
      if (( SHORT_WRITE )); then head -c 5 > "${ACTIVE_FILE}.next"; else cat > "${ACTIVE_FILE}.next"; fi
      return 0 ;;
    wc\ -c\ \<*next*)
      [[ -f "${ACTIVE_FILE}.next" ]] || return 1
      wc -c < "${ACTIVE_FILE}.next"; return 0 ;;
    cp*mv*)
      (( FAIL_PROMOTE )) && return 1
      cp "${ACTIVE_FILE}" "${ACTIVE_FILE}.previous"
      mv "${ACTIVE_FILE}.next" "${ACTIVE_FILE}"
      return 0 ;;
    mv*previous*) mv "${ACTIVE_FILE}.previous" "${ACTIVE_FILE}"; return 0 ;;
  esac
  return 0
}

eval "${body}"

NEW='upstream api_upstream { server NEW:3000; }'

# --- The defect this file exists for -----------------------------------------
reset_container
printf 'upstream api_upstream { server STALE:3000; }\n' > "${ACTIVE_FILE}.next"
FAIL_WRITE=1
if write_and_reload "${NEW}" >/dev/null 2>&1; then
  no "a failed write with a STALE .next present must not report success" \
     "returned 0; active file now: $(cat "${ACTIVE_FILE}")"
else
  ok "a failed write with a STALE .next present must not report success"
fi
if grep -q STALE "${ACTIVE_FILE}"; then
  no "a stale .next is never promoted" "STALE content is now the active upstream"
else
  ok "a stale .next is never promoted"
fi

# --- Each individual docker exec is checked ----------------------------------
reset_container; FAIL_WRITE=1
write_and_reload "${NEW}" >/dev/null 2>&1 \
  && no "a failed write returns non-zero" "returned 0" \
  || ok "a failed write returns non-zero"

reset_container; FAIL_PROMOTE=1
write_and_reload "${NEW}" >/dev/null 2>&1 \
  && no "a failed promote returns non-zero" "returned 0" \
  || ok "a failed promote returns non-zero"

reset_container; FAIL_RMNEXT=1
write_and_reload "${NEW}" >/dev/null 2>&1 \
  && no "a failed .next cleanup returns non-zero" "returned 0" \
  || ok "a failed .next cleanup returns non-zero"

# --- A truncated write must not be promoted ----------------------------------
reset_container; SHORT_WRITE=1
if write_and_reload "${NEW}" >/dev/null 2>&1; then
  no "a short write is not promoted" "returned 0"
else
  ok "a short write is not promoted"
fi
if [[ "$(cat "${ACTIVE_FILE}")" == *OLD* ]]; then
  ok "a short write leaves the previous upstream in place"
else
  no "a short write leaves the previous upstream in place" "active file was replaced"
fi

# --- The happy path still works ----------------------------------------------
reset_container
if write_and_reload "${NEW}" >/dev/null 2>&1; then
  ok "a clean write cuts over and returns 0"
else
  no "a clean write cuts over and returns 0" "returned non-zero"
fi
if grep -q NEW "${ACTIVE_FILE}"; then
  ok "the new upstream is active after a clean write"
else
  no "the new upstream is active after a clean write" "active file: $(cat "${ACTIVE_FILE}")"
fi
(( RELOADED == 1 )) \
  && ok "nginx is reloaded, never restarted" \
  || no "nginx is reloaded, never restarted" "no reload observed"

# --- nginx rejecting the config still rolls back -----------------------------
reset_container; FAIL_NGINX_T=1
write_and_reload "${NEW}" >/dev/null 2>&1 \
  && no "a config nginx rejects returns non-zero" "returned 0" \
  || ok "a config nginx rejects returns non-zero"
if [[ "$(cat "${ACTIVE_FILE}")" == *OLD* ]]; then
  ok "a rejected config restores the previous upstream"
else
  no "a rejected config restores the previous upstream" "active file: $(cat "${ACTIVE_FILE}")"
fi

echo
echo "=== ${pass} passed, ${fail} failed ==="
(( fail == 0 ))
