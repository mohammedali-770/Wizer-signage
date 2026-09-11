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

