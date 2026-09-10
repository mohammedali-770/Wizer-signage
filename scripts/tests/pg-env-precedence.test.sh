#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — .env must not clobber an explicit DIRECT_URL/DATABASE_URL
# =============================================================================
# restore-db.sh and backup-db.sh loaded .env with `set -a; source`, which
# OVERWRITES exported variables. On a production host that is a loaded gun: an
# operator exporting a scratch DIRECT_URL to restore a backup into a throwaway
# database had it silently replaced by the production URL, and restore-db.sh
# then overwrote production. With FORCE=1 there is no prompt.
#
# Explicit environment must win — the file supplies defaults, the caller
# overrides them. The helper is EXTRACTED FROM scripts/lib/pg-url.sh so these
# cases exercise shipped code.
#
# Usage:  bash scripts/tests/pg-env-precedence.test.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LIB="${ROOT_DIR}/scripts/lib/pg-url.sh"

pass=0; fail=0
ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         expected: $2"; echo "         actual:   $3"; fail=$(( fail + 1 )); }

body="$(sed -n '/^pg_load_env_file() {/,/^}/p' "${LIB}")"
[[ -n "${body}" ]] || { echo "could not extract pg_load_env_file from ${LIB}" >&2; exit 1; }
eval "${body}"

ENV_FILE="$(mktemp)"
trap 'rm -f "${ENV_FILE}"' EXIT
PROD_DIRECT='postgresql://prod:s@aws-1.pooler.supabase.com:5432/postgres'
PROD_DATABASE='postgresql://prod:s@aws-1.pooler.supabase.com:6543/postgres?pgbouncer=true'
printf 'DIRECT_URL=%s\nDATABASE_URL=%s\nOTHER_KEY=from-file\n' "${PROD_DIRECT}" "${PROD_DATABASE}" > "${ENV_FILE}"

echo "=== .env must not clobber an explicit database URL ==="

# The exact scenario that would have destroyed production.
(
  export DIRECT_URL='postgresql://drill:d@127.0.0.1:55432/drill'
  pg_load_env_file "${ENV_FILE}" 2>/dev/null
  [[ "${DIRECT_URL}" == 'postgresql://drill:d@127.0.0.1:55432/drill' ]]
) && ok "an exported DIRECT_URL survives .env" \
  || no "an exported DIRECT_URL survives .env" "the scratch URL" "the production URL"

(
  export DATABASE_URL='postgresql://drill:d@127.0.0.1:55432/drill'
  pg_load_env_file "${ENV_FILE}" 2>/dev/null
  [[ "${DATABASE_URL}" == 'postgresql://drill:d@127.0.0.1:55432/drill' ]]
) && ok "an exported DATABASE_URL survives .env" \
  || no "an exported DATABASE_URL survives .env" "the scratch URL" "the production URL"

# Overriding only one must not silently leave the other pointing at production
# in a way the caller did not intend — the file value is still used, which is
# correct, but the override that WAS given must hold.
(
  export DIRECT_URL='postgresql://drill:d@127.0.0.1:55432/drill'
  pg_load_env_file "${ENV_FILE}" 2>/dev/null
  [[ "${DIRECT_URL}" == *'127.0.0.1'* && "${DATABASE_URL}" == "${PROD_DATABASE}" ]]
) && ok "overriding one leaves the other at its .env default" \
  || no "overriding one leaves the other at its .env default" "direct=scratch, database=file" "mismatch"

# With nothing exported the file must still supply both, or every existing
# deploy path breaks.
(
  unset DIRECT_URL DATABASE_URL
  pg_load_env_file "${ENV_FILE}" 2>/dev/null
  [[ "${DIRECT_URL}" == "${PROD_DIRECT}" && "${DATABASE_URL}" == "${PROD_DATABASE}" ]]
) && ok "with nothing exported the .env values are used" \
  || no "with nothing exported the .env values are used" "both from file" "not loaded"

# Everything else in .env must still be exported as before.
(
  unset OTHER_KEY
  pg_load_env_file "${ENV_FILE}" 2>/dev/null
  [[ "${OTHER_KEY}" == 'from-file' ]]
) && ok "other .env keys are still loaded and exported" \
  || no "other .env keys are still loaded and exported" "from-file" "unset"

# An empty-string export is still an explicit choice and must be honoured,
# otherwise `DIRECT_URL= scripts/restore-db.sh` silently falls back to the file.
(
  export DIRECT_URL=''
  pg_load_env_file "${ENV_FILE}" 2>/dev/null
  [[ -z "${DIRECT_URL}" ]]
) && ok "an explicitly empty DIRECT_URL is honoured, not refilled" \
  || no "an explicitly empty DIRECT_URL is honoured, not refilled" "empty" "refilled from file"

# A missing file must be a no-op, not an error.
(
  unset DIRECT_URL
  pg_load_env_file "/nonexistent/.env" 2>/dev/null
) && ok "a missing .env is a no-op" || no "a missing .env is a no-op" "exit 0" "non-zero"

echo
echo "passed: ${pass}  failed: ${fail}"
(( fail == 0 )) || exit 1
