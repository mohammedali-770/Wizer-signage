#!/usr/bin/env bash
# Wizer Signage — versioned signed Android release entrypoint for OTA.
#
# This wrapper keeps the existing signing/test/lint/build verification in
# build-android-release.sh, but makes version identity an explicit required
# input. Gradle receives the values through ORG_GRADLE_PROJECT_* environment
# variables so they do not require source edits and do not collide with signing
# secrets.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() { printf 'ERROR [android-ota-release]: %s\n' "$*" >&2; exit 1; }

API_BASE_URL=""
VERSION_CODE=""
VERSION_NAME=""
for arg in "$@"; do
  case "${arg}" in
    --api-base-url=*) API_BASE_URL="${arg#--api-base-url=}" ;;
    --version-code=*) VERSION_CODE="${arg#--version-code=}" ;;
    --version-name=*) VERSION_NAME="${arg#--version-name=}" ;;
    -h|--help)
      cat <<'EOF'
Usage:
  scripts/build-android-ota-release.sh \
    --api-base-url=https://signage.wizer.sa/api \
    --version-code=42 \
    --version-name=1.4.2

The four WIZER_ANDROID_* signing environment variables required by
build-android-release.sh must also be set.
EOF
      exit 0
      ;;
    *) fail "Unknown argument: ${arg}" ;;
  esac
done

[[ "${API_BASE_URL}" == https://* ]] || fail "--api-base-url must be an explicit https:// URL."
[[ "${VERSION_CODE}" =~ ^[1-9][0-9]*$ ]] || fail "--version-code must be a positive integer."
[[ "${VERSION_NAME}" =~ ^[A-Za-z0-9._-]{1,40}$ ]] || fail "--version-name must match [A-Za-z0-9._-]{1,40}."

# Gradle's supported environment form for project properties. These affect only
# this process tree; no generated/local properties file is written.
export ORG_GRADLE_PROJECT_releaseVersionCode="${VERSION_CODE}"
export ORG_GRADLE_PROJECT_releaseVersionName="${VERSION_NAME}"

printf '==> [android-ota-release] Building Wizer v%s (code %s)\n' "${VERSION_NAME}" "${VERSION_CODE}"
exec "${SCRIPT_DIR}/build-android-release.sh" --api-base-url="${API_BASE_URL}"
