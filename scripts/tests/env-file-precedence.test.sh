#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — dotenv precedence: the file supplies DEFAULTS, the caller wins
# =============================================================================
# scripts/tests/pg-env-precedence.test.sh exercises the extracted loader, so it
# proves the helper is correct and nothing else. It cannot catch the failure
# that actually happened: a script that sources the helper and then does its own
# `set -a; source .env` anyway. ensure-telemetry-partitions.sh did exactly that
# while applying DDL.
#
# So this file tests the helper's behaviour AND scans every script for the
# unsafe shape, which is the part that generalises to scripts not yet written.
#
# Usage:  bash scripts/tests/env-file-precedence.test.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

pass=0; fail=0
ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         $2"; fail=$(( fail + 1 )); }

# shellcheck source=scripts/lib/env-file.sh
source "${ROOT_DIR}/scripts/lib/env-file.sh"

echo "=== env_load_defaults behaviour ==="

ENVF="$(mktemp)"
printf 'ALPHA=from-file\nBETA=from-file\nGAMMA=from-file\nexport DELTA=from-file\n' > "${ENVF}"

( export ALPHA=from-caller
  env_load_defaults "${ENVF}" ALPHA >/dev/null 2>&1
  [[ "${ALPHA}" == "from-caller" ]] ) \
  && ok "an exported value beats the file" \
  || no "an exported value beats the file" "file won"

( env_load_defaults "${ENVF}" ALPHA >/dev/null 2>&1
  [[ "${ALPHA}" == "from-file" ]] ) \
  && ok "the file supplies the value when the caller set none" \
  || no "the file supplies the value when the caller set none" "got '${ALPHA:-}'"

# The subtle one: exported-but-empty is a deliberate choice, and a `[ -n ]`
# style guard silently replaces it with the file's value.
( export BETA=""
  env_load_defaults "${ENVF}" BETA >/dev/null 2>&1
  [[ -z "${BETA}" ]] ) \
  && ok "an exported EMPTY value is preserved, not treated as unset" \
  || no "an exported EMPTY value is preserved, not treated as unset" "was overwritten"

# The deliberate limit of the explicit-names design, pinned so it cannot drift
# into blanket "caller always wins" unnoticed: a variable the caller exported
# but did NOT name is still overwritten by the file. Shielding everything would
# silently change which value unrelated variables resolve to across the deploy,
# cron and container contexts.
( export GAMMA=from-caller
  env_load_defaults "${ENVF}" ALPHA >/dev/null 2>&1
  [[ "${GAMMA}" == "from-file" ]] ) \
  && ok "a name that is NOT passed is still overridden by the file (explicit-names contract)" \
  || no "a name that is NOT passed is still overridden by the file" "got '${GAMMA:-}'"

( export DELTA=from-caller
  env_load_defaults "${ENVF}" DELTA >/dev/null 2>&1
  [[ "${DELTA}" == "from-caller" ]] ) \
  && ok "an 'export NAME=' line in the file is shielded too" \
  || no "an 'export NAME=' line in the file is shielded too" "file won"

( env_load_defaults "${ENVF}/nope" ALPHA >/dev/null 2>&1 ) \
  && ok "a missing env file is a no-op, not an error" \
  || no "a missing env file is a no-op, not an error" "returned non-zero"

( export ALPHA=from-caller
  out="$(env_load_defaults "${ENVF}" ALPHA 2>&1 >/dev/null)"
  [[ "${out}" == *ALPHA* ]] ) \
  && ok "says which variable came from the environment" \
  || no "says which variable came from the environment" "silent"

rm -f "${ENVF}"

echo
echo "=== no script may load .env as an OVERRIDE ==="
# `set -a` followed by sourcing an env file overwrites what the caller exported.
# Every such site must go through a defaults loader instead.
offenders=""
while IFS= read -r f; do
  # a `set -a` within three lines of a source/. of an env file
  if awk '
      /set -a/ { armed = 3; next }
      armed > 0 {
        if ($0 ~ /(^|[^a-zA-Z_])(source|\.)[[:space:]]+.*(ENV_FILE|\.env)/) { found = 1; exit }
        armed--
      }
      END { exit(found ? 0 : 1) }
    ' "$f"; then
    offenders="${offenders} ${f#"${ROOT_DIR}/"}"
  fi
done < <(find "${ROOT_DIR}/scripts" -name '*.sh' -type f | sort)

if [[ -z "${offenders}" ]]; then
  ok "no script sources an env file under 'set -a' outside a defaults loader"
else
  no "no script sources an env file under 'set -a' outside a defaults loader" \
     "offenders:${offenders}"
fi

echo
echo "=== call sites actually use the loader ==="
for s in ensure-telemetry-partitions.sh bootstrap-self-signed-cert.sh; do
  if grep -q 'env_load_defaults' "${ROOT_DIR}/scripts/${s}"; then
    ok "${s} loads .env as defaults"
  else
    no "${s} loads .env as defaults" "no env_load_defaults call"
  fi
done

# ensure-telemetry-partitions.sh applies DDL, so prove end-to-end that an
# exported DIRECT_URL is the one it actually connects with. The script never
# echoes the URL, so the evidence is which HOST the connection failure names.
echo
echo "=== ensure-telemetry-partitions.sh honours an exported DIRECT_URL ==="
if command -v psql >/dev/null 2>&1; then
  TREE="$(mktemp -d)"
  mkdir -p "${TREE}/scripts/lib"
  cp "${ROOT_DIR}/scripts/ensure-telemetry-partitions.sh" "${TREE}/scripts/"
  cp "${ROOT_DIR}/scripts/lib/"*.sh "${TREE}/scripts/lib/"
  printf 'DIRECT_URL=postgresql://u:p@env-file-host.invalid:5432/prod\n' > "${TREE}/.env"

  out="$(DIRECT_URL='postgresql://u:p@caller-scratch-host.invalid:5432/scratch' \
         bash "${TREE}/scripts/ensure-telemetry-partitions.sh" 2>&1)"

  if [[ "${out}" == *caller-scratch-host* ]]; then
    ok "connects to the caller's host, not the .env one"
  elif [[ "${out}" == *env-file-host* ]]; then
    no "connects to the caller's host, not the .env one" \
       "it used the .env host — DDL would have hit the wrong database"
  else
    no "connects to the caller's host, not the .env one" \
       "neither host appeared; output: ${out:0:200}"
  fi
  rm -rf "${TREE}"
else
  echo "  SKIP psql not available"
fi

echo
echo "=== ${pass} passed, ${fail} failed ==="
(( fail == 0 ))
