#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — production-preflight.sh off-box backup command validation
# =============================================================================
# "A backup that exists only on this host is not a backup." Every other gate
# around BACKUP_OFFSITE_CMD is blind to that: `cp "$1" /backups/offsite/`
# resolves inside the maintenance image, exits 0, and yields a remote byte count
# that matches the local dump exactly, so it satisfies the no-op test, the
# binary-resolution test AND the size verification while protecting nothing.
# Production ran in that state until 2026-09-09.
#
# Both functions are EXTRACTED FROM THE SCRIPT rather than copied here, so these
# cases exercise the shipped code and cannot drift from it.
#
# Usage:  bash scripts/tests/preflight-offsite-backup.test.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PREFLIGHT="${ROOT_DIR}/scripts/production-preflight.sh"

pass=0; fail=0
ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         $2"; fail=$(( fail + 1 )); }

OFFSITE_LOCAL_BIN=""
for fn in offsite_split_segments offsite_is_shell_builtin offsite_segment_executable \
          offsite_executables offsite_executable offsite_first_word offsite_is_local_copy; do
  body="$(sed -n "/^${fn}() {/,/^}/p" "${PREFLIGHT}")"
  [[ -n "${body}" ]] || { echo "could not extract ${fn} from ${PREFLIGHT}" >&2; exit 1; }
  eval "${body}"
done

echo "=== production-preflight.sh off-box backup command ==="

# local <label> <command>   — must be REJECTED as a same-host copy
local_case() {
  if offsite_is_local_copy "$2"; then ok "rejects $1"; else no "rejects $1" "accepted: $2"; fi
}
# remote <label> <command>  — must be ACCEPTED as a real off-host transport
remote_case() {
  if offsite_is_local_copy "$2"; then no "accepts $1" "rejected: $2"; else ok "accepts $1"; fi
}

# --- The exact shape production was running --------------------------------
local_case "the shape production ran" \
  'mkdir -p /backups/offsite && cp "$1" /backups/offsite/'

# --- Other local utilities with no remote transport -------------------------
local_case "a bare cp"          'cp "$1" /backups/offsite/'
local_case "mv"                 'mv "$1" /backups/offsite/'
local_case "install"            'install -m 600 "$1" /backups/offsite/'
local_case "ln"                 'ln "$1" /backups/offsite/'
local_case "dd"                 'dd if="$1" of=/backups/offsite/dump.gz'
local_case "an absolute path"   '/bin/cp "$1" /backups/offsite/'

# --- Wrapped invocations are still the same local copy -----------------------
# `command`, `env`, `sudo`, a VAR=value prefix and a leading backslash are all
# ordinary shell syntax, and a first-word check reads each of them as the
# utility. The shell still execs cp.
local_case "command cp"          'command cp "$1" /backups/offsite/'
local_case "a VAR=value prefix"  'RCLONE_X=1 cp "$1" /backups/offsite/'
local_case "env with an assignment" 'env FOO=bar cp "$1" /backups/offsite/'
local_case "backslash-escaped cp" '\cp "$1" /backups/offsite/'
local_case "sudo cp"             'sudo cp "$1" /backups/offsite/'
local_case "nice cp"             'nice cp "$1" /backups/offsite/'
local_case "a wrapper after &&"  'mkdir -p /backups/offsite && command cp "$1" /backups/offsite/'

# --- The reported utility must be the one that was detected -----------------
# The operator reads this name when deciding whether the network-mount override
# applies to them, so naming `mkdir` for `mkdir -p ... && cp ...` is a false
# diagnosis, not a cosmetic slip.
reports() {
  offsite_is_local_copy "$2" >/dev/null
  if [[ "${OFFSITE_LOCAL_BIN}" == "$3" ]]; then
    ok "reports '$3' for $1"
  else
    no "reports '$3' for $1" "reported '${OFFSITE_LOCAL_BIN}'"
  fi
}
reports "the compound production shape" 'mkdir -p /backups/offsite && cp "$1" /backups/offsite/' cp
reports "a wrapped mv"                  'mkdir -p /x && sudo mv "$1" /x/' mv

# --- Real off-host transports must still pass -------------------------------
# The documented default in .env.example, which is what the fix configures.
remote_case "the documented rclone default" \
  'rclone copyto "$1" "spaces:wizer-backups/$(basename "$1")"'
remote_case "aws s3"            'aws s3 cp "$1" s3://wizer-backups/'
remote_case "rsync over ssh"    'rsync -a "$1" backup@offsite.example:/srv/'
remote_case "scp"               'scp "$1" backup@offsite.example:/srv/'

# --- The pre-existing no-op cases must not be swallowed by the new check ----
# `cat` is a no-op for this purpose and is caught by the EARLIER gate, so it
# must NOT be reported as a local copy — otherwise the operator gets the wrong
# remedy for the wrong problem.
remote_case "cat (left to the no-op gate)" 'cat "$1" > /backups/offsite/dump.gz'

echo

# --- Resolution must see EVERY binary, not just the head --------------------
# Resolving only the head is how `mkdir -p /stage && rclone copyto ...` was
# validated as `mkdir`, leaving rclone unchecked in both the maintenance image
# and on the host -- the same class of miss that aborted the 2026-09-09 deploy
# after a dump had already been written.
execs_case() {
  local label="$1" cmd="$2" want="$3" got
  got="$(offsite_executables "${cmd}" | tr '\n' ' ')"
  got="${got% }"
  if [[ "${got}" == "${want}" ]]; then ok "${label}"; else no "${label}" "want [${want}] got [${got}]"; fi
}

execs_case "resolves the transport after a && prefix" \
  'mkdir -p /var/tmp/stage && rclone copyto "$1" spaces:b/x' 'mkdir rclone'
execs_case "resolves both sides of a pipeline" \
  'gzip -c "$1" | aws s3 cp - s3://bucket/x' 'gzip aws'
execs_case "resolves sed in the shipped verify default" \
  'rclone size --json "spaces:b/$(basename "$1")" | sed -n "s/x/y/p"' 'rclone sed'
execs_case "resolves a plain single command" \
  'rclone copyto "$1" "spaces:b/$(basename "$1")"' 'rclone'
execs_case "treats ; and || as separators too" \
  'rclone copyto "$1" a ; rclone copyto "$1" b || logger failed' 'rclone logger'

# Quote-awareness. A tr-based split invents a segment from text inside quotes,
# which both reports a phantom binary missing and -- via the classifier -- would
# abort the deploy for a `cp` that runs on the FAR side of an ssh.
execs_case "does not split on separators inside single quotes" \
  "ssh host 'mkdir -p /srv && cp \"\$1\" /srv/'" 'ssh'
execs_case "does not split on separators inside double quotes" \
  'rclone copyto "$1" "spaces:b/a&&b|c"' 'rclone'
execs_case "does not split a 2>&1 redirection" \
  'rclone copyto "$1" spaces:b/x 2>&1' 'rclone'
execs_case "does not split a >/dev/null 2>&1 redirection" \
  'rclone copyto "$1" spaces:b/x >/dev/null 2>&1' 'rclone'

# Builtins never resolve through PATH; reporting one missing would abort a
# deploy over `cd`. Duplicates are collapsed so one absent binary is named once.
execs_case "drops shell builtins" \
  'cd /tmp && rclone copyto "$1" x' 'rclone'
execs_case "collapses duplicates" \
  'rclone copyto "$1" a && rclone copyto "$1" b' 'rclone'
execs_case "keeps an absolute path that merely looks like a builtin" \
  '/usr/bin/test -f "$1" && rclone copyto "$1" x' '/usr/bin/test rclone'

# The classifier must not be fooled by a far-side copy, and must still catch a
# near-side one that is not the head of the list.
if offsite_is_local_copy "ssh host 'cp \"\$1\" /srv/'"; then
  no "does not flag a cp that runs on the far side of ssh" "flagged it"
else
  ok "does not flag a cp that runs on the far side of ssh"
fi
if offsite_is_local_copy 'mkdir -p /backups && cp "$1" /backups/'; then
  ok "still flags a local cp that is not the head of the list"
else
  no "still flags a local cp that is not the head of the list" "missed it"
fi

echo "=== ${pass} passed, ${fail} failed ==="
(( fail == 0 ))
