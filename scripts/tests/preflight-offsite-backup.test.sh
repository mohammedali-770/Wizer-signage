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

for fn in offsite_first_word offsite_is_local_copy; do
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
echo "=== ${pass} passed, ${fail} failed ==="
(( fail == 0 ))
