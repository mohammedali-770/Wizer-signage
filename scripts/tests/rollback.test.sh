#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — scripts/rollback.sh decision-logic tests
# =============================================================================
# Covers everything rollback.sh decides BEFORE it touches the running stack:
# which tag it selects, and when it refuses. Those are the parts that matter
# during an outage — a rollback that stops the stack and only then discovers the
# old images were pruned is strictly worse than no rollback at all.
#
# No Docker stack is started. `docker` is stubbed on PATH so image-presence
# checks are scriptable; every case here exits before `docker compose up`.
#
# Usage:  bash scripts/tests/rollback.test.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ROLLBACK="${ROOT_DIR}/scripts/rollback.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

pass=0
fail=0

ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         $2"; fail=$(( fail + 1 )); }

# --- Stub docker -------------------------------------------------------------
# `image inspect` succeeds only for tags listed in KNOWN_TAGS. `compose` records
# that it was reached — no test here should get that far.
mkdir -p "${WORK}/bin"
cat > "${WORK}/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  tag="${3##*:}"
  [[ " ${KNOWN_TAGS:-} " == *" ${tag} "* ]] && exit 0
  exit 1
fi
if [[ "$1" == "compose" ]]; then
  echo "COMPOSE_REACHED" >> "${STUB_LOG}"
  exit 0
fi
exit 0
STUB
chmod +x "${WORK}/bin/docker"
export PATH="${WORK}/bin:${PATH}"

# rollback.sh requires a .env; a throwaway one is enough for the paths under test.
: > "${WORK}/.env"

run_rollback() {
  local history_file="$1"; shift
  STUB_LOG="${WORK}/stub.log" \
  ENV_FILE="${WORK}/.env" \
  DEPLOY_STATE="${history_file}" \
  HEALTH_RETRIES=1 HEALTH_INTERVAL=0 \
    bash "${ROLLBACK}" "$@" 2>&1
}

echo "=== rollback.sh decision logic ==="

# --- 1. No history at all ----------------------------------------------------
out="$(run_rollback "${WORK}/absent-history")"; rc=$?
if (( rc != 0 )) && [[ "${out}" == *"no deploy history"* ]]; then
  ok "refuses when nothing has ever been deployed on this host"
else
  no "refuses when nothing has ever been deployed on this host" "rc=${rc} out=${out}"
fi

# --- 2. Only one release recorded --------------------------------------------
single="${WORK}/single"
echo "2026-08-03T10:00:00Z aaaaaaaaaaaa abc123" > "${single}"
out="$(run_rollback "${single}")"; rc=$?
if (( rc != 0 )) && [[ "${out}" == *"no earlier known-good release"* ]]; then
  ok "refuses when only the current release is recorded"
else
  no "refuses when only the current release is recorded" "rc=${rc} out=${out}"
fi

# --- 3. Picks the PREVIOUS release, not the current one ----------------------
two="${WORK}/two"
cat > "${two}" <<'HISTORY'
2026-08-03T10:00:00Z aaaaaaaaaaaa oldsha
2026-08-03T11:00:00Z bbbbbbbbbbbb newsha
HISTORY
# Neither image present => it must name the one it WANTED before refusing.
out="$(KNOWN_TAGS="" run_rollback "${two}")"; rc=$?
if (( rc != 0 )) && [[ "${out}" == *"aaaaaaaaaaaa"* ]] && [[ "${out}" != *"COMPOSE_REACHED"* ]]; then
  ok "selects the previous tag, not the one currently running"
else
  no "selects the previous tag, not the one currently running" "rc=${rc} out=${out}"
fi

# --- 4. Refuses BEFORE touching the stack when images are gone ---------------
: > "${WORK}/stub.log"
out="$(KNOWN_TAGS="" run_rollback "${two}")"; rc=$?
if (( rc != 0 )) && [[ "${out}" == *"not present on this host"* ]] \
   && ! grep -q COMPOSE_REACHED "${WORK}/stub.log" 2>/dev/null; then
  ok "refuses pruned images without stopping the running stack"
else
  no "refuses pruned images without stopping the running stack" "rc=${rc} out=${out}"
fi

# --- 5. Names every missing image, not just the first ------------------------
out="$(KNOWN_TAGS="" run_rollback "${two}")"
if [[ "${out}" == *"wizer-signage/api:aaaaaaaaaaaa"* ]] \
   && [[ "${out}" == *"wizer-signage/dashboard:aaaaaaaaaaaa"* ]] \
   && [[ "${out}" == *"wizer-signage/maintenance:aaaaaaaaaaaa"* ]]; then
  ok "lists every missing image so the operator sees the full picture"
else
  no "lists every missing image so the operator sees the full picture" "out=${out}"
fi

# --- 6. An explicit tag that is not here is refused --------------------------
out="$(KNOWN_TAGS="aaaaaaaaaaaa" run_rollback "${two}" "cccccccccccc")"; rc=$?
if (( rc != 0 )) && [[ "${out}" == *"not present on this host"* ]]; then
  ok "refuses an explicit tag that is not on this host"
else
  no "refuses an explicit tag that is not on this host" "rc=${rc} out=${out}"
fi

# --- 6b. A repeated rollback does not bounce back into the bad release -------
# After [A, B(bad), B marked rolled-back, A], the naive "second-from-last line"
# choice is B — the very release the operator just escaped.
bounce="${WORK}/bounce"
cat > "${bounce}" <<'HISTORY'
2026-08-03T09:00:00Z aaaaaaaaaaaa sha-a
2026-08-03T10:00:00Z bbbbbbbbbbbb sha-b
2026-08-03T10:05:00Z bbbbbbbbbbbb rolled-back
2026-08-03T10:05:00Z aaaaaaaaaaaa rollback
HISTORY
out="$(KNOWN_TAGS="" run_rollback "${bounce}")"; rc=$?
if (( rc != 0 )) && [[ "${out}" == *"no earlier known-good release"* ]]; then
  ok "refuses to roll back INTO a release already rolled away from"
else
  no "refuses to roll back INTO a release already rolled away from" "rc=${rc} out=${out}"
fi

# --- 6c. ...but a genuinely older release is still reachable -----------------
deeper="${WORK}/deeper"
cat > "${deeper}" <<'HISTORY'
2026-08-03T08:00:00Z 000000000000 sha-zero
2026-08-03T09:00:00Z aaaaaaaaaaaa sha-a
2026-08-03T10:00:00Z bbbbbbbbbbbb sha-b
2026-08-03T10:05:00Z bbbbbbbbbbbb rolled-back
2026-08-03T10:05:00Z aaaaaaaaaaaa rollback
HISTORY
out="$(KNOWN_TAGS="" run_rollback "${deeper}")"; rc=$?
if (( rc != 0 )) && [[ "${out}" == *"000000000000"* ]]; then
  ok "steps further back to the next genuinely older release"
else
  no "steps further back to the next genuinely older release" "rc=${rc} out=${out}"
fi

# --- 7. --list prints the history and changes nothing ------------------------
: > "${WORK}/stub.log"
out="$(run_rollback "${two}" --list)"; rc=$?
if (( rc == 0 )) && [[ "${out}" == *"aaaaaaaaaaaa"* ]] && [[ "${out}" == *"bbbbbbbbbbbb"* ]] \
   && ! grep -q COMPOSE_REACHED "${WORK}/stub.log" 2>/dev/null; then
  ok "--list shows the history without touching the stack"
else
  no "--list shows the history without touching the stack" "rc=${rc} out=${out}"
fi

# --- 8. Warns that migrations are not reverted -------------------------------
out="$(KNOWN_TAGS="aaaaaaaaaaaa bbbbbbbbbbbb" run_rollback "${two}" 2>&1)"
if [[ "${out}" == *"forward-only"* ]]; then
  ok "warns that migrations are not reverted"
else
  no "warns that migrations are not reverted" "out=${out}"
fi

echo
echo "=== ${pass} passed, ${fail} failed ==="
(( fail == 0 ))
