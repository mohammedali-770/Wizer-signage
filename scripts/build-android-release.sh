#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — Android TV player: signed production release build
# =============================================================================
# Produces a SIGNED, verified release APK for direct distribution (com.wizer.signage).
# Fails closed: it never reports success for an unsigned APK, and it aborts on
# any missing credential, test, lint, build, signing, package, or checksum error.
#
# Signing credentials come ONLY from environment variables — never files, never
# the command line (so passwords never appear in `ps`, shell history, or logs):
#
#   WIZER_ANDROID_KEYSTORE_PATH       path to the production .jks/.keystore
#   WIZER_ANDROID_KEYSTORE_PASSWORD   keystore (store) password
#   WIZER_ANDROID_KEY_ALIAS           key alias inside the keystore
#   WIZER_ANDROID_KEY_PASSWORD        password for that key
#
# These are read by Gradle (app/build.gradle.kts) via System.getenv(); this
# script only VALIDATES their presence and never prints their values. The
# keystore password is passed to apksigner via an env-var reference
# (pass:env:...), not as a literal argument.
#
# The API base URL must ALSO be stated explicitly on every release build. The
# player has no OTA channel: an APK baked against the wrong host can never pair
# or sync and is only recoverable by physically revisiting each screen. So this
# script refuses to guess and fails closed when it is not given.
#
# Usage (from anywhere):
#   export WIZER_ANDROID_KEYSTORE_PATH=/secure/wizer-signage-release.jks
#   export WIZER_ANDROID_KEYSTORE_PASSWORD=...      # e.g. read into env securely
#   export WIZER_ANDROID_KEY_ALIAS=wizer-signage
#   export WIZER_ANDROID_KEY_PASSWORD=...
#   scripts/build-android-release.sh --api-base-url=https://signage.wizer.sa/api
#
# Requirements: JDK 17, the Android SDK (ANDROID_HOME / ANDROID_SDK_ROOT) with
# build-tools (apksigner, aapt) installed, and either the Gradle wrapper jar or a
# system `gradle` on PATH. See docs/android-signing.md.
# =============================================================================

set -euo pipefail

# --- Resolve paths -----------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_DIR="${ROOT_DIR}/apps/android-tv-player"
APK_BUILT="${ANDROID_DIR}/app/build/outputs/apk/release/app-release.apk"
OUT_DIR="${ANDROID_DIR}/release-output"

log()  { printf '==> [android-release] %s\n' "$*"; }
fail() { printf 'ERROR [android-release]: %s\n' "$*" >&2; exit 1; }

# --- 0. Require an EXPLICIT API base URL (fail closed) -----------------------
# Accepts either form so it reads naturally from a shell or a CI job:
#   --api-base-url=https://signage.wizer.sa/api
#   -PapiBaseUrl=https://signage.wizer.sa/api
API_BASE_URL=""
for arg in "$@"; do
  case "${arg}" in
    --api-base-url=*) API_BASE_URL="${arg#--api-base-url=}" ;;
    -PapiBaseUrl=*)   API_BASE_URL="${arg#-PapiBaseUrl=}" ;;
    *) fail "Unknown argument: ${arg}" ;;
  esac
done
if [[ -z "${API_BASE_URL}" ]]; then
  fail "Missing --api-base-url (or -PapiBaseUrl).
A release APK bakes this host in permanently and there is no OTA update path: a
wrong value means every screen built from it can never pair or sync, and each one
has to be re-flashed by hand. State it explicitly, e.g.
  scripts/build-android-release.sh --api-base-url=https://signage.wizer.sa/api"
fi
case "${API_BASE_URL}" in
  https://*) ;;
  *) fail "--api-base-url must be an https:// URL (got: ${API_BASE_URL})." ;;
esac
log "API base URL: ${API_BASE_URL}"

# --- 1. Validate ALL four signing env vars (fail closed, names only) ---------
REQUIRED_VARS=(
  WIZER_ANDROID_KEYSTORE_PATH
  WIZER_ANDROID_KEYSTORE_PASSWORD
  WIZER_ANDROID_KEY_ALIAS
  WIZER_ANDROID_KEY_PASSWORD
)
missing=()
for v in "${REQUIRED_VARS[@]}"; do
  # Indirect expansion; treat unset or empty as missing. Never echo the value.
  if [[ -z "${!v:-}" ]]; then missing+=("$v"); fi
done
if (( ${#missing[@]} > 0 )); then
  fail "Missing required signing environment variable(s): ${missing[*]}
This command builds a DISTRIBUTABLE signed APK and refuses to run without all
four credentials. (Set them, or use 'gradle :app:assembleDebug' for dev builds.)"
fi

# --- 2. Validate the keystore exists and is readable -------------------------
KS_PATH="${WIZER_ANDROID_KEYSTORE_PATH}"
[[ -f "${KS_PATH}" ]] || fail "Keystore not found at WIZER_ANDROID_KEYSTORE_PATH: ${KS_PATH}"
[[ -r "${KS_PATH}" ]] || fail "Keystore is not readable: ${KS_PATH}"
log "Keystore present and readable: ${KS_PATH}"

# --- Locate Android SDK build-tools (apksigner + aapt) -----------------------
SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "${SDK_ROOT}" && -d "${SDK_ROOT}" ]] || fail "ANDROID_HOME / ANDROID_SDK_ROOT is not set to a valid Android SDK."
# Pick the highest-versioned build-tools directory that has apksigner.
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
log "Using build-tools: ${BUILD_TOOLS_DIR}"

# --- Choose Gradle invocation ------------------------------------------------
# Order: explicit WIZER_GRADLE_CMD override > committed wrapper > system gradle.
# The override lets CI (or an offline/pinned environment) point at a specific
# gradle without editing this script.
cd "${ANDROID_DIR}"
if [[ -n "${WIZER_GRADLE_CMD:-}" ]]; then
  # shellcheck disable=SC2206  # intentional word-splitting for a command + args
  GRADLE=(${WIZER_GRADLE_CMD})
elif [[ -f "${ANDROID_DIR}/gradle/wrapper/gradle-wrapper.jar" ]]; then
  GRADLE=("${ANDROID_DIR}/gradlew")
elif command -v gradle >/dev/null 2>&1; then
  GRADLE=(gradle)
else
  fail "No Gradle available: set WIZER_GRADLE_CMD, provide the wrapper jar, or put 'gradle' on PATH."
fi
# Pass the API host to every task so tests, lint and the build all configure the
# project identically (a differing -P value forces a re-configuration).
GRADLE+=(--no-daemon --console=plain -PapiBaseUrl="${API_BASE_URL}")

# --- 3-5. Tests, lint, signed release build ----------------------------------
# The four WIZER_ANDROID_* vars are already exported in this shell, so Gradle
# picks them up and produces a SIGNED app-release.apk. Passwords are never on
# the command line.
log "Running unit tests (:app:testDebugUnitTest) ..."
"${GRADLE[@]}" :app:testDebugUnitTest

log "Running Android lint (:app:lintRelease) ..."
"${GRADLE[@]}" :app:lintRelease

log "Building signed release APK (:app:assembleRelease) ..."
"${GRADLE[@]}" :app:assembleRelease

# --- 6. Locate the APK deterministically -------------------------------------
[[ -f "${APK_BUILT}" ]] || fail "Expected signed APK not found at ${APK_BUILT}.
(An UNSIGNED build would land at app-release-unsigned.apk — that means signing
did not run; check the WIZER_ANDROID_* variables.)"
log "Built APK: ${APK_BUILT}"

# --- 7. Verify it is actually signed (apksigner) -----------------------------
log "Verifying signature (apksigner verify) ..."
VERIFY_OUT="$("${APKSIGNER}" verify --verbose --print-certs "${APK_BUILT}")"
# Report which schemes are present (Phase 4). apksigner prints, e.g.:
#   Verified using v1 scheme (JAR signing): true
#   Verified using v2 scheme (APK Signature Scheme v2): true
#   Verified using v3 scheme (APK Signature Scheme v3): true
scheme_v1="$(printf '%s\n' "${VERIFY_OUT}" | grep -i 'Verified using v1 scheme' | head -1)"
scheme_v2="$(printf '%s\n' "${VERIFY_OUT}" | grep -i 'Verified using v2 scheme' | head -1)"
scheme_v3="$(printf '%s\n' "${VERIFY_OUT}" | grep -i 'Verified using v3 scheme' | head -1)"
# minSdk 21 REQUIRES the v1 (JAR) scheme for Android 5.0-6.0 installs.
printf '%s\n' "${VERIFY_OUT}" | grep -iqE 'Verified using v1 scheme \(JAR signing\): *true' \
  || fail "APK is not v1-signed; Android 5.0 (minSdk 21) requires the v1 (JAR) scheme."

# --- 8. Safe certificate + package/version info (NO secrets) -----------------
CERT_SHA256="$(printf '%s\n' "${VERIFY_OUT}" | grep -i 'certificate SHA-256 digest:' | head -1 | sed 's/.*digest: *//')"
CERT_DN="$(printf '%s\n' "${VERIFY_OUT}" | grep -i 'certificate DN:' | head -1 | sed 's/.*DN: *//')"
[[ -n "${CERT_SHA256}" ]] || fail "Could not read the certificate SHA-256 fingerprint from apksigner output."

BADGING="$("${AAPT}" dump badging "${APK_BUILT}" 2>/dev/null || true)"
PKG="$(printf '%s\n' "${BADGING}" | sed -n "s/.*package: name='\([^']*\)'.*/\1/p" | head -1)"
VERSION_NAME="$(printf '%s\n' "${BADGING}" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)"
VERSION_CODE="$(printf '%s\n' "${BADGING}" | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" | head -1)"
[[ -n "${PKG}" && -n "${VERSION_NAME}" && -n "${VERSION_CODE}" ]] || fail "Could not read package/version info via aapt."

# --- 9. Confirm the package is exactly com.wizer.signage ---------------------
EXPECTED_PKG="com.wizer.signage"
[[ "${PKG}" == "${EXPECTED_PKG}" ]] || fail "Package mismatch: got '${PKG}', expected '${EXPECTED_PKG}'."

# --- 11-12. Copy to gitignored output with clear, non-overwriting names ------
mkdir -p "${OUT_DIR}"
ARTIFACT="wizer-signage-v${VERSION_NAME}-${VERSION_CODE}.apk"
DEST_APK="${OUT_DIR}/${ARTIFACT}"
DEST_SUM="${DEST_APK}.sha256"
[[ ! -e "${DEST_APK}" ]] || fail "Refusing to overwrite existing release: ${DEST_APK}
(Bump versionCode/versionName, or remove the old artifact intentionally.)"
[[ ! -e "${DEST_SUM}" ]] || fail "Refusing to overwrite existing checksum: ${DEST_SUM}"
cp "${APK_BUILT}" "${DEST_APK}"

# --- 10. SHA-256 checksum file (portable: sha256sum or shasum) ---------------
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "${OUT_DIR}" && sha256sum "${ARTIFACT}" > "${ARTIFACT}.sha256" )
elif command -v shasum >/dev/null 2>&1; then
  ( cd "${OUT_DIR}" && shasum -a 256 "${ARTIFACT}" > "${ARTIFACT}.sha256" )
else
  fail "Neither sha256sum nor shasum is available to generate the checksum."
fi
# Verify the checksum we just wrote (fail closed on any mismatch).
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "${OUT_DIR}" && sha256sum -c "${ARTIFACT}.sha256" >/dev/null )
else
  ( cd "${OUT_DIR}" && shasum -a 256 -c "${ARTIFACT}.sha256" >/dev/null )
fi

# --- Summary (safe values only) ----------------------------------------------
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
  Record the Cert SHA-256 fingerprint above in your key registry. Distribute
  ONLY this signed artifact. See docs/android-signing.md for the update test.
============================================================================
EOF
