#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — scripts/deploy.sh smoke-test gate
# =============================================================================
# Covers the part of a deploy that decides whether a release is allowed to stand:
# the smoke test, and — the subtle half — what gets written to the deploy history
# when it fails.
#
# That history is rollback.sh's only input. It reads the LAST line as "currently
# running" and steps back from there, so a failed release MUST still be recorded:
# omit it and the last line becomes the previous GOOD release, and a rollback
# steps past it to the one before. These tests pin that ordering, because it is
# invisible until the day it matters.
#
# No stack is started. git, docker, compose, curl and the backup script are all
# stubbed on PATH; the deploy never leaves this directory.
#
# Usage:  bash scripts/tests/deploy-gate.test.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

pass=0; fail=0
ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         $2"; fail=$(( fail + 1 )); }

# --- A throwaway copy of the repo's scripts ---------------------------------
# deploy.sh resolves its root from its own location, so it is copied into a
# sandbox with stubbed siblings rather than run from the real tree.
SANDBOX="${WORK}/repo"
mkdir -p "${SANDBOX}/scripts" "${SANDBOX}/infra/docker"
cp "${ROOT_DIR}/scripts/deploy.sh" "${SANDBOX}/scripts/"
: > "${SANDBOX}/infra/docker/docker-compose.yml"
printf 'APP_DOMAIN=signage.test.invalid\n' > "${SANDBOX}/.env"

# backup-db.sh is a hard gate earlier in the deploy; stub it as succeeding.
printf '#!/usr/bin/env bash\nexit 0\n' > "${SANDBOX}/scripts/backup-db.sh"
chmod +x "${SANDBOX}/scripts/backup-db.sh"

# --- Stubs -------------------------------------------------------------------
mkdir -p "${WORK}/bin"

# git: enough for fetch/checkout/pull and a stable SHA.
cat > "${WORK}/bin/git" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  rev-parse) [[ "${2:-}" == "--short=12" ]] && echo "abcdef123456" || echo "abcdef123456789012345678901234567890abcd" ;;
  *) exit 0 ;;
esac
STUB

# docker / docker compose: accept everything, do nothing.
cat > "${WORK}/bin/docker" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB

# curl: the readiness poll must succeed so the deploy reaches the gate.
cat > "${WORK}/bin/curl" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB

chmod +x "${WORK}/bin/"*
export PATH="${WORK}/bin:${PATH}"

# Swap in a smoke test whose verdict this harness controls.
write_smoke() {
  local exit_code="$1"
  cat > "${SANDBOX}/scripts/smoke-test.sh" <<STUB
#!/usr/bin/env bash
echo "SMOKE_RAN url=\$1"
exit ${exit_code}
STUB
  chmod +x "${SANDBOX}/scripts/smoke-test.sh"
}

run_deploy() {
  OUT="$(cd "${SANDBOX}" && "$@" bash "${SANDBOX}/scripts/deploy.sh" 2>&1)"
  RC=$?
}

history_lines() { wc -l < "${SANDBOX}/.deploy-history" 2>/dev/null | tr -d ' '; }
reset_history() { : > "${SANDBOX}/.deploy-history"; }

echo "=== deploy.sh smoke-test gate ==="

# --- 1. A passing smoke test lets the deploy finish --------------------------
write_smoke 0; reset_history
run_deploy env
if (( RC == 0 )) && [[ "${OUT}" == *"Smoke test passed."* ]]; then
  ok "a passing smoke test completes the deploy"
else
  no "a passing smoke test completes the deploy" "rc=${RC}
${OUT}"
fi

# --- 2. A failing smoke test fails the deploy --------------------------------
write_smoke 1; reset_history
run_deploy env
if (( RC != 0 )) && [[ "${OUT}" == *"smoke test did not pass"* ]]; then
  ok "a failing smoke test fails the deploy"
else
  no "a failing smoke test fails the deploy" "rc=${RC}
${OUT}"
fi

# --- 3. ...and still records the release ------------------------------------
# The invisible one. Skip this write and a later rollback steps past the last
# good release instead of back to it.
if [[ "$(history_lines)" == "1" ]] && grep -q "abcdef123456" "${SANDBOX}/.deploy-history"; then
  ok "a smoke-failed release is still recorded, so rollback steps back correctly"
else
  no "a smoke-failed release is still recorded, so rollback steps back correctly" \
     "history=$(cat "${SANDBOX}/.deploy-history" 2>/dev/null)"
fi

# --- 4. The failure names the recovery ---------------------------------------
if [[ "${OUT}" == *"scripts/rollback.sh"* ]]; then
  ok "the failure tells the operator how to roll back"
else
  no "the failure tells the operator how to roll back" "${OUT}"
fi

# --- 5. SKIP_SMOKE is an explicit, visible override --------------------------
write_smoke 1; reset_history
run_deploy env SKIP_SMOKE=1
if (( RC == 0 )) && [[ "${OUT}" == *"Smoke test SKIPPED"* ]] && [[ "${OUT}" != *"SMOKE_RAN"* ]]; then
  ok "SKIP_SMOKE=1 bypasses the gate and says so"
else
  no "SKIP_SMOKE=1 bypasses the gate and says so" "rc=${RC}
${OUT}"
fi

# --- 6. The public URL is used, so TLS checks are exercised ------------------
# Against http://localhost the TLS, HSTS and redirect checks all skip — the
# deploy would "pass" a smoke test that never looked at the edge.
write_smoke 0; reset_history
run_deploy env
if [[ "${OUT}" == *"SMOKE_RAN url=https://signage.test.invalid"* ]]; then
  ok "smoke-tests the public HTTPS URL from APP_DOMAIN, not localhost"
else
  no "smoke-tests the public HTTPS URL from APP_DOMAIN, not localhost" "${OUT}"
fi

# --- 7. SMOKE_URL overrides APP_DOMAIN ---------------------------------------
write_smoke 0; reset_history
run_deploy env SMOKE_URL=https://override.test.invalid
if [[ "${OUT}" == *"SMOKE_RAN url=https://override.test.invalid"* ]]; then
  ok "SMOKE_URL overrides the derived URL"
else
  no "SMOKE_URL overrides the derived URL" "${OUT}"
fi

# --- 8. A missing smoke script warns rather than silently passing ------------
rm -f "${SANDBOX}/scripts/smoke-test.sh"; reset_history
run_deploy env
if (( RC == 0 )) && [[ "${OUT}" == *"missing or not executable"* ]]; then
  ok "a missing smoke script warns loudly instead of passing quietly"
else
  no "a missing smoke script warns loudly instead of passing quietly" "rc=${RC}
${OUT}"
fi

echo
echo "=== ${pass} passed, ${fail} failed ==="
(( fail == 0 ))
