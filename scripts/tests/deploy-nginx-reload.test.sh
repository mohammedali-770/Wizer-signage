#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — scripts/deploy.sh nginx re-resolution step
# =============================================================================
# nginx caches the container IPs of the `api` and `dashboard` upstreams at
# startup. `compose up -d` gives those containers NEW IPs, so every request 502s
# until nginx re-resolves — the deploy MUST do something about it, and what it
# does is load-bearing in a way that is invisible in a green deploy log:
#
#   `restart` kills the container, dropping every connection it holds. On this
#   platform that means content uploads (up to 300 MB, minutes long over a
#   venue's uplink) die mid-body and the user starts over.
#
#   `reload` starts workers on the new config while the old workers finish the
#   requests they are already serving. Nothing in flight is dropped.
#
# Both leave a deploy that "worked", so these tests pin which one runs, and the
# fallback that must still exist for the case where a reload is impossible —
# stranding the stack on dead upstream IPs would be worse than dropping
# connections.
#
# No stack is started; git, docker and curl are stubbed on PATH.
#
# Usage:  bash scripts/tests/deploy-nginx-reload.test.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

pass=0; fail=0
ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         $2"; fail=$(( fail + 1 )); }

echo "==> deploy.sh nginx re-resolution tests"

# --- Sandbox -----------------------------------------------------------------
SANDBOX="${WORK}/repo"
mkdir -p "${SANDBOX}/scripts" "${SANDBOX}/infra/docker"
cp "${ROOT_DIR}/scripts/deploy.sh" "${SANDBOX}/scripts/"
: > "${SANDBOX}/infra/docker/docker-compose.yml"
printf 'APP_DOMAIN=signage.example.com\n' > "${SANDBOX}/.env"

printf '#!/usr/bin/env bash\nexit 0\n' > "${SANDBOX}/scripts/backup-db.sh"
chmod +x "${SANDBOX}/scripts/backup-db.sh"

# --- Stubs -------------------------------------------------------------------
mkdir -p "${WORK}/bin"

cat > "${WORK}/bin/git" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  rev-parse) [[ "${2:-}" == "--short=12" ]] && echo "abcdef123456" || echo "abcdef123456789012345678901234567890abcd" ;;
  *) exit 0 ;;
esac
STUB

# docker: records every invocation, and fails the specific sub-commands named by
# FAIL_NGINX_TEST / FAIL_NGINX_RELOAD so the fallback path can be exercised.
cat > "${WORK}/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${DOCKER_LOG}"
case "$*" in
  *"nginx -t"*)       [[ "${FAIL_NGINX_TEST:-0}"   == "1" ]] && exit 1 ;;
  *"nginx -s reload"*) [[ "${FAIL_NGINX_RELOAD:-0}" == "1" ]] && exit 1 ;;
esac
exit 0
STUB

cat > "${WORK}/bin/curl" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB

chmod +x "${WORK}/bin/"*
export PATH="${WORK}/bin:${PATH}"

# Run a deploy and leave its docker invocations in ${DOCKER_LOG}.
run_deploy() { # run_deploy <log-name> [VAR=VAL ...]
  DOCKER_LOG="${WORK}/$1.log"
  export DOCKER_LOG
  : > "${DOCKER_LOG}"
  shift
  env "$@" \
    DEPLOY_STATE="${WORK}/history" \
    SKIP_SMOKE=1 \
    HEALTH_RETRIES=1 \
    bash "${SANDBOX}/scripts/deploy.sh" >"${DOCKER_LOG}.out" 2>&1
}

logged()     { grep -qF "$1" "${DOCKER_LOG}"; }
line_of()    { grep -nF "$1" "${DOCKER_LOG}" | head -1 | cut -d: -f1; }

# --- 1. The happy path reloads, and does not restart -------------------------
run_deploy happy FAIL_NGINX_TEST=0 FAIL_NGINX_RELOAD=0

if logged "nginx -s reload"; then
  ok "a healthy nginx is reloaded"
else
  no "a healthy nginx is reloaded" "no 'nginx -s reload' in the docker log"
fi

if logged "restart nginx"; then
  no "no restart when the reload succeeded" "'restart nginx' ran anyway — in-flight uploads would be dropped"
else
  ok "no restart when the reload succeeded"
fi

if logged "nginx -t"; then
  ok "the config is tested before it is reloaded"
else
  no "the config is tested before it is reloaded" "no 'nginx -t' in the docker log"
fi

t_line="$(line_of 'nginx -t')"; r_line="$(line_of 'nginx -s reload')"
if [[ -n "${t_line}" && -n "${r_line}" && "${t_line}" -lt "${r_line}" ]]; then
  ok "nginx -t runs BEFORE the reload"
else
  no "nginx -t runs BEFORE the reload" "test at line ${t_line:-none}, reload at ${r_line:-none}"
fi

u_line="$(line_of 'up -d')"
if [[ -n "${u_line}" && -n "${r_line}" && "${u_line}" -lt "${r_line}" ]]; then
  ok "the reload happens AFTER the containers are recreated"
else
  no "the reload happens AFTER the containers are recreated" \
     "up -d at line ${u_line:-none}, reload at ${r_line:-none} — reloading first re-resolves the OLD IPs"
fi

# --- 2. A broken config must not be reloaded into place ----------------------
run_deploy badconfig FAIL_NGINX_TEST=1 FAIL_NGINX_RELOAD=0

if logged "nginx -s reload"; then
  no "a failing nginx -t stops the reload" "reload was attempted despite a failed config test"
else
  ok "a failing nginx -t stops the reload"
fi

if logged "restart nginx"; then
  ok "a failing nginx -t falls back to restart rather than stranding stale IPs"
else
  no "a failing nginx -t falls back to restart rather than stranding stale IPs" \
     "neither reloaded nor restarted — every request would 502 on dead upstream IPs"
fi

# --- 3. A reload that cannot run must still re-resolve -----------------------
run_deploy noreload FAIL_NGINX_TEST=0 FAIL_NGINX_RELOAD=1

if logged "restart nginx"; then
  ok "an unreloadable nginx falls back to restart"
else
  no "an unreloadable nginx falls back to restart" \
     "the stack would keep proxying to the recreated containers' old IPs"
fi

# --- 4. The deploy still succeeds through the fallback -----------------------
# The fallback is a degradation, not a failure: dropping connections is bad,
# aborting the deploy half-applied is worse.
if [[ -f "${WORK}/history" ]] && grep -q "abcdef123456" "${WORK}/history"; then
  ok "the release is still recorded when the fallback was taken"
else
  no "the release is still recorded when the fallback was taken" \
     "deploy history has no entry — rollback.sh would step back past this release"
fi

echo
echo "==> ${pass} passed, ${fail} failed"
[[ "${fail}" -eq 0 ]]
