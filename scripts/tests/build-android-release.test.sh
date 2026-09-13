#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/build-android-release.sh"

fail_case() {
  local expected="$1"; shift
  local out status
  set +e
  out="$(env -u WIZER_ANDROID_KEYSTORE_PATH \
             -u WIZER_ANDROID_KEYSTORE_PASSWORD \
             -u WIZER_ANDROID_KEY_ALIAS \
             -u WIZER_ANDROID_KEY_PASSWORD \
             bash "${SCRIPT}" "$@" 2>&1)"
  status=$?
  set -e
  [[ ${status} -ne 0 ]] || { echo "expected failure for: $*" >&2; exit 1; }
  grep -Fq -- "${expected}" <<<"${out}" || {
    echo "expected '${expected}' for: $*" >&2
    printf '%s\n' "${out}" >&2
    exit 1
  }
}

fail_case "Missing --version-name" \
  --api-base-url=https://signage.wizer.sa/api \
  --version-code=42

fail_case "Missing --version-code" \
  --api-base-url=https://signage.wizer.sa/api \
  --version-name=1.4.2

fail_case "--version-name must not contain '..'" \
  --api-base-url=https://signage.wizer.sa/api \
  --version-name=1..4 \
  --version-code=42

fail_case "--version-code must be a positive base-10 integer" \
  --api-base-url=https://signage.wizer.sa/api \
  --version-name=1.4.2 \
  --version-code=0

fail_case "must not target a local/private development host" \
  --api-base-url=https://192.168.1.20/api \
  --version-name=1.4.2 \
  --version-code=42

# A syntactically valid production coordinate must get past all release-identity
# checks and fail at the NEXT boundary (missing signing credentials). This pins
# the happy-path parser without requiring an Android SDK/keystore in this test.
fail_case "Missing required signing environment variable(s)" \
  --api-base-url=https://signage.wizer.sa/api \
  --version-name=1.4.2 \
  --version-code=42

echo "build-android-release argument tests passed"

# --- Refactor guard ----------------------------------------------------------
# apksigner is invoked through the APKSIGNER_CMD array so a build-tools path
# containing a space stays one argument. A leftover bare "${APKSIGNER}" from a
# partial refactor is not a syntax error -- it fails at runtime, under `set -u`,
# deep into a publish that has already verified and staged the APK. That is
# exactly how it was found, so it is pinned here.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
leftover=0
for f in "${ROOT_DIR}/scripts/build-android-release.sh" "${ROOT_DIR}/scripts/publish-android-release.sh"; do
  if grep -q '"\${APKSIGNER}"' "$f"; then
    echo "FAIL: $(basename "$f") still calls a bare \${APKSIGNER}; use \"\${APKSIGNER_CMD[@]}\"" >&2
    leftover=1
  fi
  if ! grep -q 'APKSIGNER_CMD\[@\]' "$f"; then
    echo "FAIL: $(basename "$f") never invokes APKSIGNER_CMD" >&2
    leftover=1
  fi
done
[[ "${leftover}" -eq 0 ]] || exit 1
echo "apksigner invocation guard passed"


# --- Publish lock must be trapped the moment it is held ----------------------
# The publish lock is acquired, and only later was `trap cleanup EXIT` installed.
# Between those two points sit the two MOST LIKELY failures in the whole script:
# re-publishing a version that already exists, and mktemp failing. Exiting there
# left the mkdir lock directory behind (Git Bash on Windows has no flock, and
# that is exactly where releases are published from), so the next publish waited
# its full 30s timeout and then refused to run.
#
# Ordering is the invariant, so ordering is what this asserts: the trap must be
# installed AFTER the lock is taken (LOCK_MODE has to be set for cleanup to know
# how to release it) and BEFORE the first reachable failure after that.
PUB="${ROOT_DIR}/scripts/publish-android-release.sh"
acq_ln="$(grep -n 'LOCK_MODE=mkdir' "${PUB}" | head -1 | cut -d: -f1)"
trap_ln="$(grep -n '^trap cleanup EXIT' "${PUB}" | head -1 | cut -d: -f1)"
[[ -n "${acq_ln}" && -n "${trap_ln}" ]] || {
  echo "FAIL: could not locate lock acquisition and/or the EXIT trap" >&2; exit 1; }
# First line after acquisition that can terminate the script via fail().
next_fail_ln="$(awk -v a="${acq_ln}" 'NR>a && /(\|\| *fail |^ *fail )/ {print NR; exit}' "${PUB}")"
[[ -n "${next_fail_ln}" ]] || {
  echo "FAIL: no fail() path found after the lock; this guard would be vacuous" >&2; exit 1; }
(( acq_ln < trap_ln )) || {
  echo "FAIL: EXIT trap (line ${trap_ln}) is installed before the lock is held (line ${acq_ln})" >&2
  exit 1; }
(( trap_ln < next_fail_ln )) || {
  echo "FAIL: publish can fail at line ${next_fail_ln} while holding the lock, but the EXIT trap is only installed at line ${trap_ln} -- the lock would be left behind" >&2
  exit 1; }
# cleanup runs before STAGING exists, so it must tolerate an unset STAGING.
grep -q 'STAGING:-' "${PUB}" || {
  echo "FAIL: cleanup() dereferences STAGING without a :- guard; it now runs before STAGING is set" >&2
  exit 1; }
echo "publish lock trap ordering guard passed (lock ${acq_ln} < trap ${trap_ln} < first fail ${next_fail_ln})"
