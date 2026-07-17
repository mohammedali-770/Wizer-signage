#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — Android TV player: publish a signed release for distribution
# =============================================================================
# Takes a VERIFIED, signed release APK (com.wizer.signage) and publishes it
# ATOMICALLY into the downloads directory that the production stack serves at
# https://<domain>/api/downloads/android/ (nginx, read-only). It exposes:
#   - an immutable versioned APK          wizer-signage-v<name>-<code>.apk
#   - its SHA-256 checksum                wizer-signage-v<name>-<code>.apk.sha256
#   - a per-version manifest              wizer-signage-v<name>-<code>.json
#   - a machine-readable latest manifest  latest.json   (updated LAST, atomically)
#
# It FAILS CLOSED. It publishes nothing unless the APK is signed with all of
# v1+v2+v3, has package com.wizer.signage, and its signing certificate matches
# the trusted fingerprint in WIZER_ANDROID_EXPECTED_CERT_SHA256. It never
# overwrites an existing version and never publishes a versionCode <= the
# current latest. The canonical filename is derived from the APK's own verified
# metadata, never from the (untrusted) source filename.
#
# Required environment variable (PUBLIC info, not a secret — but mandatory):
#   WIZER_ANDROID_EXPECTED_CERT_SHA256   expected signing-cert SHA-256 fingerprint
#                                        (hex, colons/case ignored).
#
# Usage:
#   WIZER_ANDROID_EXPECTED_CERT_SHA256=AA:BB:...:FF \
#     scripts/publish-android-release.sh <signed.apk> [--downloads-dir DIR] [--allow-symlink]
#
# --downloads-dir DIR  target downloads root (default: <repo>/downloads, the
#                      host side of the compose bind mount). The APK subtree is
#                      published under DIR/android/. Override WIZER_DOWNLOADS_DIR.
# --allow-symlink      permit a symlinked APK input (resolved + re-validated).
#
# This script writes ONLY to the local downloads directory. It never uploads to
# a remote host. Transfer to the VPS (scp/rsync) is a separate, explicit step —
# see docs/android-distribution.md.
#
# Requirements: Android SDK build-tools (apksigner, aapt) via ANDROID_HOME /
# ANDROID_SDK_ROOT, plus python3, sha256sum (or shasum), flock, mktemp.
# =============================================================================

set -euo pipefail

# --- Paths -------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

log()  { printf '==> [publish-android] %s\n' "$*"; }
fail() { printf 'ERROR [publish-android]: %s\n' "$*" >&2; exit 1; }

# --- Args --------------------------------------------------------------------
APK_SRC=""
DOWNLOADS_DIR="${WIZER_DOWNLOADS_DIR:-${ROOT_DIR}/downloads}"
ALLOW_SYMLINK=0
while (( $# > 0 )); do
  case "$1" in
    --downloads-dir) DOWNLOADS_DIR="${2:?--downloads-dir needs a value}"; shift 2 ;;
    --allow-symlink) ALLOW_SYMLINK=1; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) fail "Unknown option: $1" ;;
    *)  [[ -z "${APK_SRC}" ]] || fail "Unexpected extra argument: $1"; APK_SRC="$1"; shift ;;
  esac
done
[[ -n "${APK_SRC}" ]] || fail "Usage: $0 <signed.apk> [--downloads-dir DIR] [--allow-symlink]"

EXPECTED_PKG="com.wizer.signage"

# --- 1/2. Validate required commands -----------------------------------------
need_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"; }
need_cmd python3
need_cmd flock
need_cmd mktemp
need_cmd stat
if command -v sha256sum >/dev/null 2>&1; then SHA256=(sha256sum); SHA256C=(sha256sum -c)
elif command -v shasum >/dev/null 2>&1;   then SHA256=(shasum -a 256); SHA256C=(shasum -a 256 -c)
else fail "Neither sha256sum nor shasum is available."; fi

# Locate Android build-tools (apksigner + aapt), highest version that has apksigner.
SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "${SDK_ROOT}" && -d "${SDK_ROOT}" ]] || fail "ANDROID_HOME / ANDROID_SDK_ROOT is not a valid Android SDK."
BUILD_TOOLS_DIR=""
while IFS= read -r d; do
  [[ -x "${d}/apksigner" ]] && { BUILD_TOOLS_DIR="${d}"; break; }
done < <(find "${SDK_ROOT}/build-tools" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -Vr)
[[ -n "${BUILD_TOOLS_DIR}" ]] || fail "apksigner not found under ${SDK_ROOT}/build-tools."
APKSIGNER="${BUILD_TOOLS_DIR}/apksigner"
AAPT="${BUILD_TOOLS_DIR}/aapt"; [[ -x "${AAPT}" ]] || AAPT="${BUILD_TOOLS_DIR}/aapt2"
[[ -x "${AAPT}" ]] || fail "aapt/aapt2 not found under ${BUILD_TOOLS_DIR}."

# --- 3/4. Validate the input APK (regular file; symlink policy) --------------
[[ -e "${APK_SRC}" ]] || fail "APK not found: ${APK_SRC}"
if [[ -L "${APK_SRC}" ]]; then
  (( ALLOW_SYMLINK == 1 )) || fail "Refusing symlinked APK input (pass --allow-symlink to resolve): ${APK_SRC}"
  APK_SRC="$(readlink -f -- "${APK_SRC}")" || fail "Could not resolve symlink."
  log "Resolved symlink to: ${APK_SRC}"
fi
[[ -f "${APK_SRC}" ]] || fail "APK is not a regular file: ${APK_SRC}"
[[ -r "${APK_SRC}" ]] || fail "APK is not readable: ${APK_SRC}"

# --- 9. Require + normalize the expected certificate fingerprint -------------
# Public info, but MANDATORY. Normalize: strip colons/whitespace, lowercase.
normalize_fp() { printf '%s' "$1" | tr -d ' :\t\r\n' | tr '[:upper:]' '[:lower:]'; }
[[ -n "${WIZER_ANDROID_EXPECTED_CERT_SHA256:-}" ]] \
  || fail "WIZER_ANDROID_EXPECTED_CERT_SHA256 is required (the expected signing-cert SHA-256 fingerprint)."
EXPECTED_FP="$(normalize_fp "${WIZER_ANDROID_EXPECTED_CERT_SHA256}")"
[[ "${EXPECTED_FP}" =~ ^[0-9a-f]{64}$ ]] \
  || fail "WIZER_ANDROID_EXPECTED_CERT_SHA256 is not a 64-hex-char SHA-256 (colons/case allowed)."

# --- 5/6. apksigner verification: require v1 + v2 + v3 -----------------------
log "Verifying APK signature (apksigner)..."
VERIFY_OUT="$("${APKSIGNER}" verify --verbose --print-certs "${APK_SRC}" 2>/dev/null)" \
  || fail "apksigner could not verify the APK (unsigned or corrupt): ${APK_SRC}"
scheme_ok() { printf '%s\n' "${VERIFY_OUT}" | grep -qiE "Verified using $1 scheme[^:]*: *true"; }
scheme_ok v1 || fail "APK is not v1-signed (JAR signing) — required for minSdk 21 / Android 5.0."
scheme_ok v2 || fail "APK is not v2-signed (APK Signature Scheme v2) — required."
scheme_ok v3 || fail "APK is not v3-signed (APK Signature Scheme v3) — required."

# --- 8. Extract + validate certificate identity ------------------------------
# SECURITY: parse the fingerprint/DN from the LINE-ANCHORED signer record only.
# apksigner prints an attacker-controlled certificate subject on the
# "Signer #N certificate DN:" line, which precedes the real
# "Signer #N certificate SHA-256 digest:" line. An unanchored match would let a
# crafted DN (e.g. CN=certificate SHA-256 digest: <expected fp>) inject a fake
# fingerprint that a naive `head -1` would pick first. Anchoring to
# "^Signer #N certificate SHA-256 digest:" makes the DN line non-matching.
NUM_SIGNERS="$(printf '%s\n' "${VERIFY_OUT}" | sed -n 's/^Number of signers: *//p' | head -1)"
[[ "${NUM_SIGNERS}" == "1" ]] || fail "Expected exactly one signer, got '${NUM_SIGNERS:-unknown}'. Refusing (multi-signer/rotation-lineage APK)."
DIGEST_LINES="$(printf '%s\n' "${VERIFY_OUT}" | sed -n 's/^Signer #[0-9][0-9]* certificate SHA-256 digest: *//p')"
[[ "$(printf '%s\n' "${DIGEST_LINES}" | grep -c .)" == "1" ]] || fail "Expected exactly one certificate SHA-256 digest line. Refusing."
CERT_FP="$(normalize_fp "${DIGEST_LINES}")"
CERT_DN="$(printf '%s\n' "${VERIFY_OUT}" | sed -n 's/^Signer #[0-9][0-9]* certificate DN: *//p' | head -1)"
[[ "${CERT_FP}" =~ ^[0-9a-f]{64}$ ]] || fail "Could not read the APK's certificate SHA-256 fingerprint."

# --- 10. Reject debug-signed APKs (defense in depth) -------------------------
case "${CERT_DN}" in
  *"Android Debug"*|*"CN=Android Debug"*) fail "Refusing a DEBUG-signed APK (certificate DN: ${CERT_DN})." ;;
esac

# --- 9. Enforce the expected certificate fingerprint -------------------------
[[ "${CERT_FP}" == "${EXPECTED_FP}" ]] || fail "Signing certificate fingerprint MISMATCH.
  expected: ${EXPECTED_FP}
  apk     : ${CERT_FP}
Refusing to publish an APK signed with an unexpected key."
log "Certificate fingerprint matches the expected production key."

# --- 8. Extract + validate package / version / minSdk metadata ---------------
BADGING="$("${AAPT}" dump badging "${APK_SRC}" 2>/dev/null)" || fail "aapt could not read the APK."
meta() { printf '%s\n' "${BADGING}" | sed -n "s/.*$1='\([^']*\)'.*/\1/p" | head -1; }
PKG="$(meta "package: name")"
VERSION_NAME="$(meta "versionName")"
VERSION_CODE="$(meta "versionCode")"
MIN_SDK="$(printf '%s\n' "${BADGING}" | sed -n "s/.*sdkVersion:'\([^']*\)'.*/\1/p" | head -1)"

# --- 7/11. Confirm package + strict metadata shapes (safe filename) ----------
[[ "${PKG}" == "${EXPECTED_PKG}" ]] || fail "Package mismatch: got '${PKG}', expected '${EXPECTED_PKG}'."
[[ "${VERSION_NAME}" =~ ^[A-Za-z0-9._-]+$ ]] \
  || fail "versionName '${VERSION_NAME}' has characters unsafe for a filename ([A-Za-z0-9._-] only)."
[[ "${VERSION_NAME}" != "." && "${VERSION_NAME}" != ".." && "${VERSION_NAME}" != *".."* ]] \
  || fail "versionName '${VERSION_NAME}' is not a safe path component."
[[ "${VERSION_CODE}" =~ ^[0-9]+$ ]] || fail "versionCode '${VERSION_CODE}' is not a positive integer."
[[ "${MIN_SDK}" =~ ^[0-9]+$ ]]      || fail "minSdk '${MIN_SDK}' is not an integer."
(( VERSION_CODE > 0 )) || fail "versionCode must be > 0."

# --- 12. Canonical filename from VERIFIED metadata (not the source name) -----
FNAME="wizer-signage-v${VERSION_NAME}-${VERSION_CODE}.apk"
# Belt-and-suspenders: the generated name must be a single safe path component.
[[ "${FNAME}" != *"/"* && "${FNAME}" != *".."* ]] || fail "Refusing unsafe generated filename: ${FNAME}"
DOWNLOAD_URL="/api/downloads/android/${FNAME}"
[[ "${DOWNLOAD_URL}" != *".."* ]] || fail "Refusing downloadUrl with traversal: ${DOWNLOAD_URL}"

# --- Size + APK checksum -----------------------------------------------------
SIZE_BYTES="$(stat -c %s "${APK_SRC}" 2>/dev/null || stat -f %z "${APK_SRC}")"
[[ "${SIZE_BYTES}" =~ ^[0-9]+$ ]] || fail "Could not determine APK size."
APK_SHA256="$("${SHA256[@]}" "${APK_SRC}" | awk '{print $1}')"
[[ "${APK_SHA256}" =~ ^[0-9a-f]{64}$ ]] || fail "Could not compute the APK SHA-256."

ANDROID_DIR="${DOWNLOADS_DIR%/}/android"
DEST_APK="${ANDROID_DIR}/${FNAME}"
DEST_SUM="${DEST_APK}.sha256"
DEST_VER_JSON="${ANDROID_DIR}/wizer-signage-v${VERSION_NAME}-${VERSION_CODE}.json"
LATEST_JSON="${ANDROID_DIR}/latest.json"

log "Publishing: ${PKG} v${VERSION_NAME} (code ${VERSION_CODE}, minSdk ${MIN_SDK}, ${SIZE_BYTES} bytes)"
log "  -> ${DEST_APK}"

# --- Serialize publishes (avoid races on version check + latest.json) --------
mkdir -p "${DOWNLOADS_DIR}"
LOCK="${DOWNLOADS_DIR%/}/.publish-android.lock"
exec 9>"${LOCK}"
flock -w 30 9 || fail "Could not acquire publish lock (${LOCK}); another publish may be running."

mkdir -p "${ANDROID_DIR}"

# --- 13. Never overwrite an existing version ---------------------------------
[[ ! -e "${DEST_APK}" ]] || fail "Version already published (refusing to overwrite): ${DEST_APK}"
[[ ! -e "${DEST_SUM}" ]] || fail "Checksum already present (refusing to overwrite): ${DEST_SUM}"
[[ ! -e "${DEST_VER_JSON}" ]] || fail "Version manifest already present: ${DEST_VER_JSON}"

# --- 14. Refuse versionCode <= highest already published (no silent downgrade)
# The authoritative downgrade floor is the maximum versionCode among the
# IMMUTABLE APKs already on disk (filename wizer-signage-v<name>-<code>.apk),
# NOT the mutable latest.json — so a missing or partially-transferred latest.json
# cannot silently disable the guard. If latest.json IS present it must still
# parse (fail closed on a corrupt pointer).
if [[ -e "${LATEST_JSON}" ]]; then
  python3 -c 'import json,sys; int(json.load(open(sys.argv[1]))["versionCode"])' "${LATEST_JSON}" >/dev/null 2>&1 \
    || fail "Existing latest.json is present but unreadable/invalid; refusing to publish until it is fixed or restored: ${LATEST_JSON}"
fi
DISK_MAX_VC=-1
shopt -s nullglob
for f in "${ANDROID_DIR}"/wizer-signage-v*-*.apk; do
  code="${f##*-}"; code="${code%.apk}"            # trailing -<code>.apk segment
  [[ "${code}" =~ ^[0-9]+$ ]] || continue
  (( code > DISK_MAX_VC )) && DISK_MAX_VC="${code}"
done
shopt -u nullglob
if (( DISK_MAX_VC >= 0 )); then
  (( VERSION_CODE > DISK_MAX_VC )) || fail "Refusing downgrade/duplicate: versionCode ${VERSION_CODE} <= highest published ${DISK_MAX_VC}.
Rollback is a deliberate, separate procedure — see docs/android-distribution.md (Retention & rollback)."
  log "versionCode ${VERSION_CODE} > highest published ${DISK_MAX_VC}."
fi

# --- 15/16. Stage OUTSIDE the served android/ dir, then publish atomically ---
# Staging lives directly under the downloads root (same filesystem as android/,
# so mv is an atomic rename), NOT under android/, so nginx never exposes it.
STAGING="$(mktemp -d "${DOWNLOADS_DIR%/}/.publish.XXXXXX")" || fail "Could not create staging dir."
cleanup() { rm -rf "${STAGING}" 2>/dev/null || true; }
trap cleanup EXIT

S_APK="${STAGING}/${FNAME}"
S_SUM="${STAGING}/${FNAME}.sha256"
S_VER_JSON="${STAGING}/version.json"
S_LATEST="${STAGING}/latest.json"

# Copy the APK into staging and re-verify integrity + signature on the COPY.
cp -- "${APK_SRC}" "${S_APK}"
COPY_SHA="$("${SHA256[@]}" "${S_APK}" | awk '{print $1}')"
[[ "${COPY_SHA}" == "${APK_SHA256}" ]] || fail "Staged APK checksum differs from source (copy corruption)."
"${APKSIGNER}" verify "${S_APK}" >/dev/null 2>&1 || fail "Staged APK failed apksigner re-verification."

# --- 18. Checksum file (name-relative) + verify it ---------------------------
( cd "${STAGING}" && "${SHA256[@]}" "${FNAME}" > "${FNAME}.sha256" )
( cd "${STAGING}" && "${SHA256C[@]}" "${FNAME}.sha256" >/dev/null ) || fail "Staged checksum failed self-verification."

# --- 3/19/20. Build + validate JSON manifests with python3 (no shell concat) -
emit_manifest() { # $1 = output path
  PKG="${PKG}" VN="${VERSION_NAME}" VC="${VERSION_CODE}" FN="${FNAME}" \
  URL="${DOWNLOAD_URL}" SHA="${APK_SHA256}" CERT="${CERT_FP}" \
  SIZE="${SIZE_BYTES}" MINSDK="${MIN_SDK}" TS="${PUBLISHED_AT}" OUT="$1" \
  python3 <<'PY'
import json, os
doc = {
    "schemaVersion": 1,
    "packageName": os.environ["PKG"],
    "versionName": os.environ["VN"],
    "versionCode": int(os.environ["VC"]),
    "fileName": os.environ["FN"],
    "downloadUrl": os.environ["URL"],
    "sha256": os.environ["SHA"],
    "certificateSha256": os.environ["CERT"],
    "sizeBytes": int(os.environ["SIZE"]),
    "minSdk": int(os.environ["MINSDK"]),
    "publishedAt": os.environ["TS"],
}
# Guard: downloadUrl must stay under the immutable android/ prefix, no traversal.
assert doc["downloadUrl"].startswith("/api/downloads/android/"), "bad downloadUrl prefix"
assert ".." not in doc["downloadUrl"], "downloadUrl traversal"
with open(os.environ["OUT"], "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
PY
}
validate_json() { python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$1" || fail "Generated JSON is invalid: $1"; }

PUBLISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
emit_manifest "${S_VER_JSON}"; validate_json "${S_VER_JSON}"
emit_manifest "${S_LATEST}";   validate_json "${S_LATEST}"

# --- 15/17/20. Atomic publish (mv = rename). latest.json goes LAST. ----------
# Re-check non-existence under the lock immediately before each move.
[[ ! -e "${DEST_APK}" ]] || fail "Race: ${DEST_APK} appeared; aborting without changes."
mv -- "${S_APK}"      "${DEST_APK}"
mv -- "${S_SUM}"      "${DEST_SUM}"
mv -- "${S_VER_JSON}" "${DEST_VER_JSON}"
# Only NOW, after the immutable version + checksum + per-version manifest are in
# place and valid, flip the mutable latest pointer atomically.
mv -- "${S_LATEST}"   "${LATEST_JSON}"

cleanup; trap - EXIT
flock -u 9 2>/dev/null || true

cat <<EOF

============================================================================
  PUBLISHED (local downloads dir; not uploaded anywhere)
----------------------------------------------------------------------------
  Package        : ${PKG}
  Version        : ${VERSION_NAME} (code ${VERSION_CODE}, minSdk ${MIN_SDK})
  APK            : ${DEST_APK}
  Checksum       : ${DEST_SUM}
  Version manifest: ${DEST_VER_JSON}
  Latest manifest : ${LATEST_JSON}
  Public URL     : ${DOWNLOAD_URL}
  Latest URL     : /api/downloads/android/latest.json
  APK SHA-256    : ${APK_SHA256}
  Cert SHA-256   : ${CERT_FP}
----------------------------------------------------------------------------
  Immutable versioned URLs never change. Transfer this downloads dir to the
  VPS (scp/rsync) if you published locally. See docs/android-distribution.md.
============================================================================
EOF
