#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — production-preflight.sh .env value parsing
# =============================================================================
# read_env_value trimmed with `xargs`, which parses its input as shell-ish
# words: quotes and backslashes are syntax to it, not data. It also stripped one
# leading and one trailing quote unconditionally, so a value ending in `"` but
# not starting with one LOST its closing quote — creating exactly the imbalance
# xargs then died on.
#
# Every BACKUP_OFFSITE_* value is a shell command and legitimately contains
# quotes. On 2026-09-09 that aborted a production deploy with
# "xargs: unmatched double quote" immediately after the offsite-image check,
# before any further gate could run.
#
# The function is EXTRACTED FROM THE SCRIPT rather than copied here, so these
# cases exercise the shipped code and cannot drift from it.
#
# Usage:  bash scripts/tests/preflight-env-parsing.test.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PREFLIGHT="${ROOT_DIR}/scripts/production-preflight.sh"

pass=0; fail=0
ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         expected: [$2]"; echo "         actual:   [$3]"; fail=$(( fail + 1 )); }

for fn in read_env_raw read_env_value offsite_assignment_is_source_safe; do
  body="$(sed -n "/^${fn}() {/,/^}/p" "${PREFLIGHT}")"
  [[ -n "${body}" ]] || { echo "could not extract ${fn} from ${PREFLIGHT}" >&2; exit 1; }
  eval "${body}"
done

ENV_FILE="$(mktemp)"
trap 'rm -f "${ENV_FILE}"' EXIT

# case <label> <env line> <key> <expected value>
case_is() {
  printf '%s\n' "$2" > "${ENV_FILE}"
  local got
  got="$(read_env_value "$3" 2>&1)"
  if [[ "${got}" == "$4" ]]; then ok "$1"; else no "$1" "$4" "${got}"; fi
}

echo "=== production-preflight.sh .env value parsing ==="

# --- The form backup-db.sh documents, which is what aborted the deploy -------
# Single-quoted, because backup-db.sh SOURCES .env and double quotes would
# expand $(basename "$1") at source time. This exact shape produced
# "xargs: unmatched double quote" and killed a production deploy on 2026-09-09.
case_is "the documented verify command that broke the deploy" \
  'BACKUP_OFFSITE_VERIFY_CMD='"'"'rclone size --json "remote:b/$(basename "$1")" | sed -n "s/.*\"bytes\":\([0-9]*\).*/\1/p"'"'"'' \
  BACKUP_OFFSITE_VERIFY_CMD \
  'rclone size --json "remote:b/$(basename "$1")" | sed -n "s/.*\"bytes\":\([0-9]*\).*/\1/p"'

# xargs did not only crash: on values it COULD parse it silently ate the
# quotes, so this was gated as `rclone copyto $1 remote:b/$(basename $1)` --
# a command nothing would ever run.
case_is "the documented copy command keeps its quotes" \
  "BACKUP_OFFSITE_CMD='rclone copyto \"\$1\" \"remote:b/\$(basename \"\$1\")\"'" \
  BACKUP_OFFSITE_CMD \
  'rclone copyto "$1" "remote:b/$(basename "$1")"'

case_is "an unwrapped command with && and quotes is read verbatim" \
  'BACKUP_OFFSITE_CMD=mkdir -p /t && rclone copyto "$1" "spaces:b/$(basename "$1")"' \
  BACKUP_OFFSITE_CMD \
  'mkdir -p /t && rclone copyto "$1" "spaces:b/$(basename "$1")"'

# --- Quote handling ---------------------------------------------------------
case_is "a matched double-quoted value has its quotes stripped" \
  'SMTP_FROM="Wizer Signage <no-reply@wizer.sa>"' \
  SMTP_FROM 'Wizer Signage <no-reply@wizer.sa>'

case_is "a matched single-quoted value has its quotes stripped" \
  "BACKUP_OFFSITE_CMD='rclone copyto x y'" \
  BACKUP_OFFSITE_CMD 'rclone copyto x y'

case_is "a lone TRAILING quote is preserved, not stripped" \
  'K=echo "hi"' K 'echo "hi"'

case_is "a lone LEADING quote is preserved, not stripped" \
  'K="unterminated' K '"unterminated'

case_is "inner quotes survive untouched" \
  'K=a "b c" d' K 'a "b c" d'

case_is "mismatched quote styles are not treated as a pair" \
  "K=\"mixed'" K "\"mixed'"

# --- Characters xargs would eat ---------------------------------------------
case_is "backslashes survive" \
  'K=printf %s\n' K 'printf %s\n'

case_is "a backslash-escaped quote survives" \
  'K=sed s/\"/x/' K 'sed s/\"/x/'

# --- Trimming and general parsing -------------------------------------------
case_is "surrounding whitespace is trimmed" \
  'K=   spaced   ' K 'spaced'

case_is "internal runs of whitespace are NOT collapsed" \
  'K=a    b' K 'a    b'

case_is "a value containing = keeps everything after the first one" \
  'DATABASE_URL=postgres://u:p@h/db?x=1&y=2' DATABASE_URL 'postgres://u:p@h/db?x=1&y=2'

case_is "an empty value reads as empty" 'K=' K ''

case_is "a missing key reads as empty" 'OTHER=1' K ''

case_is "a CRLF line ending is stripped" \
  "$(printf 'K=value\r')" K 'value'

# A single-character value must not be mangled by the length>=2 pair check.
case_is "a one-character value survives" 'K=x' K 'x'
case_is "a bare single quote survives" "K='" K "'"

# Later definitions win, matching how the shell sources a .env.
printf 'K=first\nK=second\n' > "${ENV_FILE}"
got="$(read_env_value K 2>&1)"
if [[ "${got}" == "second" ]]; then ok "the last definition wins"; else no "the last definition wins" "second" "${got}"; fi

# --- source safety ----------------------------------------------------------
# backup-db.sh does `source "${ENV_FILE}"` under set -euo pipefail. A value
# only Compose can parse passes every other gate and then aborts the mandatory
# pre-migration backup, mid-deploy.
safe() {
  if offsite_assignment_is_source_safe "$2"; then ok "accepts $1"; else no "accepts $1" "accepted" "rejected"; fi
}
unsafe() {
  if offsite_assignment_is_source_safe "$2"; then no "rejects $1" "rejected" "accepted"; else ok "rejects $1"; fi
}

safe   "the documented single-quoted command" "'rclone copyto \"\$1\" \"remote:b/\$(basename \"\$1\")\"'"
safe   "a double-quoted command with nothing to expand" '"rclone copyto /tmp/x remote:b"'
safe   "a single unquoted word" 'true'
safe   "an empty value" ''

# bash reads `KEY=rclone` as an assignment prefix and runs the rest.
unsafe "an unwrapped multi-word command" 'rclone size --json "spaces:b/$(basename "$1")"'
# Double quotes expand $1 and $(...) at source time, storing the wrong command.
unsafe "a double-quoted command containing \$" '"rclone copyto \"$1\" remote:b"'
unsafe "a double-quoted command containing a backtick" '"rclone copyto `date` remote:b"'

echo
echo "passed: ${pass}  failed: ${fail}"
(( fail == 0 )) || exit 1
