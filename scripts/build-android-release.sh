#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — Android TV player: signed production release build
# =============================================================================
# Produces a SIGNED, verified release APK for direct distribution (com.wizer.signage).
# Fails closed: it never reports success for an unsigned APK, and it aborts on
# any missing credential, version identity, test, lint, build, signing, package,
# or checksum error.
#
# Signing credentials come ONLY from environment variables — never tracked files,
# hardcoded values, or literal command-line passwords:
#
#   WIZER_ANDROID_KEYSTORE_PATH
#   WIZER_ANDROID_KEYSTORE_PASSWORD
#   WIZER_ANDROID_KEY_ALIAS
#   WIZER_ANDROID_KEY_PASSWORD
#
# The public API base URL and immutable release identity are also mandatory on
# EVERY production build. OTA rollout pins versionName + versionCode exactly, so
# allowing Gradle's development defaults here could create an unaddressable or
# non-monotonic release even when the APK is otherwise signed correctly.
#
# Usage (from anywhere):
#   export WIZER_ANDROID_KEYSTORE_PATH=/secure/wizer-signage-release.jks
#   export WIZER_ANDROID_KEYSTORE_PASSWORD=...
#   export WIZER_ANDROID_KEY_ALIAS=wizer-signage
#   export WIZER_ANDROID_KEY_PASSWORD=...
#   scripts/build-android-release.sh \
#     --api-base-url=https://signage.wizer.sa/api \
#     --version-name=1.4.2 \
#     --version-code=42
#
# Requirements: JDK 17, Android SDK build-tools (apksigner + aapt/aapt2), and
# either the committed Gradle wrapper jar or a system Gradle.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_DIR="${ROOT_DIR}/apps/android-tv-player"
APK_BUILT="${ANDROID_DIR}/app/build/outputs/apk/release/app-release.apk"
OUT_DIR="${ANDROID_DIR}/release-output"

log()  { printf '==> [android-release] %s\n' "$*"; }
fail() { printf 'ERROR [android-release]: %s\n' "$*" >&2; exit 1; }

# --- 0. Require explicit API + immutable version identity --------------------
API_BASE_URL=""
REQUESTED_VERSION_NAME=""
REQUESTED_VERSION_CODE=""
for arg in "$@"; do
  case "${arg}" in
    --api-base-url=*) API_BASE_URL="${arg#--api-base-url=}" ;;
    -PapiBaseUrl=*) API_BASE_URL="${arg#-PapiBaseUrl=}" ;;
    --version-name=*) REQUESTED_VERSION_NAME="${arg#--version-name=}" ;;
    -PreleaseVersionName=*) REQUESTED_VERSION_NAME="${arg#-PreleaseVersionName=}" ;;
    --version-code=*) REQUESTED_VERSION_CODE="${arg#--version-code=}" ;;
    -PreleaseVersionCode=*) REQUESTED_VERSION_CODE="${arg#-PreleaseVersionCode=}" ;;
    *) fail "Unknown argument: ${arg}" ;;
  esac
done

[[ -n "${API_BASE_URL}" ]] || fail "Missing --api-base-url. Example: --api-base-url=https://signage.wizer.sa/api"
case "${API_BASE_URL}" in
  https://*) ;;
  *) fail "--api-base-url must be an https:// URL (got: ${API_BASE_URL})." ;;
esac
# Reject URL userinfo/query/fragment and obvious non-production local hosts.
if [[ "${API_BASE_URL}" =~ [?#] ]] || [[ "${API_BASE_URL}" =~ ^https://[^/]*@ ]]; then
  fail "--api-base-url must be a clean HTTPS base URL without credentials, query, or fragment."
fi
case "${API_BASE_URL}" in
  https://localhost*|https://127.*|https://10.*|https://192.168.*)
    fail "--api-base-url must not target a local/private development host for a production APK." ;;
esac

[[ -n "${REQUESTED_VERSION_NAME}" ]] || fail "Missing --version-name (for example 1.4.2)."
[[ "${REQUESTED_VERSION_NAME}" =~ ^[A-Za-z0-9._-]{1,40}$ ]] \
  || fail "--version-name must match [A-Za-z0-9._-]{1,40}."
[[ "${REQUESTED_VERSION_NAME}" != *..* ]] \
  || fail "--version-name must not contain '..'."

[[ -n "${REQUESTED_VERSION_CODE}" ]] || fail "Missing --version-code (positive integer, monotonically increasing)."
[[ "${REQUESTED_VERSION_CODE}" =~ ^[1-9][0-9]*$ ]] \
  || fail "--version-code must be a positive base-10 integer."
# Android versionCode is a positive 32-bit-ish integer with platform max 2100000000.
(( REQUESTED_VERSION_CODE <= 2100000000 )) \
  || fail "--version-code exceeds Android's supported maximum (2100000000)."

log "API base URL: ${API_BASE_URL}"
log "Release identity: ${REQUESTED_VERSION_NAME} (${REQUESTED_VERSION_CODE})"

# --- 1. Validate ALL four signing env vars (fail closed, names only) ---------
REQUIRED_VARS=(
  WIZER_ANDROID_KEYSTORE_PATH
  WIZER_ANDROID_KEYSTORE_PASSWORD
  WIZER_ANDROID_KEY_ALIAS
  WIZER_ANDROID_KEY_PASSWORD
)
missing=()
for v in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!v:-}" ]]; then missing+=("$v"); fi
done
if (( ${#missing[@]} > 0 )); then
  fail "Missing required signing environment variable(s): ${missing[*]}
This command builds a DISTRIBUTABLE signed APK and refuses to run without all
four credentials. Use ':app:assembleDebug' for development builds."
fi

# --- 2. Validate the keystore exists and is readable -------------------------
KS_PATH="${WIZER_ANDROID_KEYSTORE_PATH}"
[[ -f "${KS_PATH}" ]] || fail "Keystore not found at WIZER_ANDROID_KEYSTORE_PATH: ${KS_PATH}"
[[ -r "${KS_PATH}" ]] || fail "Keystore is not readable: ${KS_PATH}"
log "Keystore present and readable: ${KS_PATH}"

# --- Locate Android SDK build-tools ------------------------------------------
SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "${SDK_ROOT}" && -d "${SDK_ROOT}" ]] || fail "ANDROID_HOME / ANDROID_SDK_ROOT is not set to a valid Android SDK."
BUILD_TOOLS_DIR=""
if [[ -d "${SDK_ROOT}/build-tools" ]]; then
  while IFS= read -r d; do
    if [[ -x "${d}/apksigner" ]]; then BUILD_TOOLS_DIR="${d}"; break; fi
  done < <(find "${SDK_ROOT}/build-tools" -maxdepth 1 -mindepth 1 -type d | sort -Vr)
fi
[[ -n "${BUILD_TOOLS_DIR}" ]] || fail "Could not find 'apksigner' under ${SDK_ROOT}/build-tools. Install Android build-tools."
APKSIGNER="${BUILD_TOOLS_DIR}/apksigner"
AAPT="${BUILD_TOOLS_DIR}/aapt"
[[ -x "${AAPT}" ]] || AAPT="${BUILD_TOOLS_DIR}/aapt2"
[[ -x "${AAPT}" ]] || fail "Could not find aapt/aapt2 under ${BUILD_TOOLS_DIR}."
log "Using build-tools: ${BUILD_TOOLS_DIR}"

# --- Choose Gradle invocation ------------------------------------------------
cd "${ANDROID_DIR}"
if [[ -n "${WIZER_GRADLE_CMD:-}" ]]; then
  # shellcheck disable=SC2206
  GRADLE=(${WIZER_GRADLE_CMD})
elif [[ -f "${ANDROID_DIR}/gradle/wrapper/gradle-wrapper.jar" ]]; then
  GRADLE=("${ANDROID_DIR}/gradlew")
elif command -v gradle >/dev/null 2>&1; then
  GRADLE=(gradle)
else
  fail "No Gradle available: set WIZER_GRADLE_CMD, provide the wrapper jar, or put 'gradle' on PATH."
fi
# Configure tests/lint/release identically. These explicit properties are the
# only supported production path; Gradle defaults remain dev/CI conveniences.
GRADLE+=(
  --no-daemon
  --console=plain
  -PapiBaseUrl="${API_BASE_URL}"
  -PreleaseVersionName="${REQUESTED_VERSION_NAME}"
  -PreleaseVersionCode="${REQUESTED_VERSION_CODE}"
)

# --- 3-5. Tests, lint, signed release build ----------------------------------
log "Running unit tests (:app:testDebugUnitTest) ..."
"${GRADLE[@]}" :app:testDebugUnitTest

log "Running Android lint (:app:lintRelease) ..."
"${GRADLE[@]}" :app:lintRelease

log "Building signed release APK (:app:assembleRelease) ..."
"${GRADLE[@]}" :app:assembleRelease

# --- 6. Locate the APK deterministically -------------------------------------
[[ -f "${APK_BUILT}" ]] || fail "Expected signed APK not found at ${APK_BUILT}.
An unsigned build lands at app-release-unsigned.apk; that is never publishable."
log "Built APK: ${APK_BUILT}"

# --- 7. Verify it is actually signed -----------------------------------------
log "Verifying signature (apksigner verify) ..."
VERIFY_OUT="$("${APKSIGNER}" verify --verbose --print-certs "${APK_BUILT}")"
scheme_v1="$(printf '%s\n' "${VERIFY_OUT}" | grep -i 'Verified using v1 scheme' | head -1)"
scheme_v2="$(printf '%s\n' "${VERIFY_OUT}" | grep -i 'Verified using v2 scheme' | head -1)"
scheme_v3="$(printf '%s\n' "${VERIFY_OUT}" | grep -i 'Verified using v3 scheme' | head -1)"
printf '%s\n' "${VERIFY_OUT}" | grep -iqE 'Verified using v1 scheme \(JAR signing\): *true' \
  || fail "APK is not v1-signed; Android 5.0 (minSdk 21) requires v1 signing."

# --- 8. Safe certificate + package/version info -----------------------------
CERT_SHA256="$(printf '%s\n' "${VERIFY_OUT}" | grep -i 'certificate SHA-256 digest:' | head -1 | sed 's/.*digest: *//')"
CERT_DN="$(printf '%s\n' "${VERIFY_OUT}" | grep -i 'certificate DN:' | head -1 | sed 's/.*DN: *//')"
[[ -n "${CERT_SHA256}" ]] || fail "Could not read certificate SHA-256 fingerprint from apksigner output."

BADGING="$("${AAPT}" dump badging "${APK_BUILT}" 2>/dev/null || true)"
PKG="$(printf '%s\n' "${BADGING}" | sed -n "s/.*package: name='\([^']*\)'.*/\1/p" | head -1)"
VERSION_NAME="$(printf '%s\n' "${BADGING}" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)"
VERSION_CODE="$(printf '%s\n' "${BADGING}" | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" | head -1)"
[[ -n "${PKG}" && -n "${VERSION_NAME}" && -n "${VERSION_CODE}" ]] || fail "Could not read package/version info via aapt."

# --- 9. Verify package AND requested immutable version identity ---------------
EXPECTED_PKG="com.wizer.signage"
[[ "${PKG}" == "${EXPECTED_PKG}" ]] || fail "Package mismatch: got '${PKG}', expected '${EXPECTED_PKG}'."
[[ "${VERSION_NAME}" == "${REQUESTED_VERSION_NAME}" ]] \
  || fail "Built versionName '${VERSION_NAME}' does not equal requested '${REQUESTED_VERSION_NAME}'."
[[ "${VERSION_CODE}" == "${REQUESTED_VERSION_CODE}" ]] \
  || fail "Built versionCode '${VERSION_CODE}' does not equal requested '${REQUESTED_VERSION_CODE}'."

# --- 10-12. Non-overwriting output + checksum -------------------------------
mkdir -p "${OUT_DIR}"
ARTIFACT="wizer-signage-v${VERSION_NAME}-${VERSION_CODE}.apk"
DEST_APK="${OUT_DIR}/${ARTIFACT}"
DEST_SUM="${DEST_APK}.sha256"
[[ ! -e "${DEST_APK}" ]] || fail "Refusing to overwrite existing release: ${DEST_APK}
Use a new monotonically increasing versionCode."
[[ ! -e "${DEST_SUM}" ]] || fail "Refusing to overwrite existing checksum: ${DEST_SUM}"
cp "${APK_BUILT}" "${DEST_APK}"

if command -v sha256sum >/dev/null 2>&1; then
  ( cd "${OUT_DIR}" && sha256sum "${ARTIFACT}" > "${ARTIFACT}.sha256" )
elif command -v shasum >/dev/null 2>&1; then
  ( cd "${OUT_DIR}" && shasum -a 256 "${ARTIFACT}" > "${ARTIFACT}.sha256" )
else
  fail "Neither sha256sum nor shasum is available to generate the checksum."
fi
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "${OUT_DIR}" && sha256sum -c "${ARTIFACT}.sha256" >/dev/null )
else
  ( cd "${OUT_DIR}" && shasum -a 256 -c "${ARTIFACT}.sha256" >/dev/null )
fi

cat <<EOF

============================================================================
  SIGNED RELEASE OK
----------------------------------------------------------------------------
  Package            : ${PKG}
  API base URL       : ${API_BASE_URL}
  versionName        : ${VERSION_NAME}
  versionCode        : ${VERSION_CODE}
  Signature schemes  : ${scheme_v1:-v1 present}
                       ${scheme_v2:-v2: (see apksigner output)}
                       ${scheme_v3:-v3: (see apksigner output)}
  Certificate DN     : ${CERT_DN:-<unavailable>}
  Cert SHA-256       : ${CERT_SHA256}
  Artifact           : ${DEST_APK}
  Checksum           : ${DEST_SUM}
----------------------------------------------------------------------------
  Record the certificate fingerprint in the key registry. Publish ONLY this
  verified artifact through scripts/publish-android-release.sh.
============================================================================
EOF
