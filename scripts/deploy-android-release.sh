#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — Android TV player: deploy a signed release to the VPS
# =============================================================================
# TWO TRUST STAGES so the production VPS needs NO Android SDK / Gradle / Java:
#
#   A) TRUSTED build/operator machine (this script runs here):
#      full cryptographic verification + bundle production via
#      scripts/publish-android-release.sh — apksigner (v1+v2+v3), package check,
#      expected-cert fingerprint, version extraction, checksum, and the JSON
#      manifests. Produces a complete, verified release bundle locally.
#
#   B) PRODUCTION VPS (over authenticated SSH):
#      receives the already-verified bundle into a unique staging dir,
#      RE-VERIFIES the APK SHA-256, then atomically publishes it. The remote
#      side uses ONLY normal host tools: sha256sum, mkdir, mv, flock, find, rm
#      (+ sshd/sftp). It never runs apksigner/aapt/Gradle/Java/Python.
#
# Signing keys/passwords NEVER leave the trusted machine. SSH provides the
# authenticated, integrity-protected transport; the VPS independently verifies
# the APK checksum before publishing.
#
# Usage:
#   WIZER_ANDROID_EXPECTED_CERT_SHA256=AA:BB:...:FF \
#     scripts/deploy-android-release.sh <signed.apk> \
#       --host deploy@vps.example.com \
#       --remote-downloads /opt/wizer-signage/downloads \
#       [--port 22] [--identity ~/.ssh/id_ed25519] [--dry-run]
#
#   # Or deploy an already-produced bundle (skips local SDK verification):
#   scripts/deploy-android-release.sh --bundle <bundle-dir> --host ... --remote-downloads ...
#
# This script performs a REAL SSH transfer only when you give it a real --host.
# It never disables host-key checking, never embeds passwords (key/agent only),
# and never prints key material.
#
# Trusted-machine requirements: ssh, scp, plus (APK mode) the same tools
# publish-android-release.sh needs. VPS requirements: sshd + sftp, sha256sum,
# mkdir, mv, flock, find, rm. See docs/android-distribution.md.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PUBLISH="${SCRIPT_DIR}/publish-android-release.sh"

log()  { printf '==> [deploy-android] %s\n' "$*"; }
fail() { printf 'ERROR [deploy-android]: %s\n' "$*" >&2; exit 1; }

# --- Args --------------------------------------------------------------------
APK_SRC=""; BUNDLE_IN=""; HOSTSPEC=""; REMOTE_DOWNLOADS=""; PORT=""; IDENTITY=""; DRY_RUN=0
while (( $# > 0 )); do
  case "$1" in
    --bundle)           BUNDLE_IN="${2:?--bundle needs a dir}"; shift 2 ;;
    --host)             HOSTSPEC="${2:?--host needs user@host}"; shift 2 ;;
    --remote-downloads) REMOTE_DOWNLOADS="${2:?--remote-downloads needs a path}"; shift 2 ;;
    --port)             PORT="${2:?--port needs a number}"; shift 2 ;;
    --identity)         IDENTITY="${2:?--identity needs a key path}"; shift 2 ;;
    --dry-run)          DRY_RUN=1; shift ;;
    -h|--help)          grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)                 fail "Unknown option: $1" ;;
    *)                  [[ -z "${APK_SRC}" ]] || fail "Unexpected extra argument: $1"; APK_SRC="$1"; shift ;;
  esac
done

[[ -n "${APK_SRC}" || -n "${BUNDLE_IN}" ]] || fail "Provide a signed <apk> or --bundle <dir>."
[[ -z "${APK_SRC}" || -z "${BUNDLE_IN}" ]] || fail "Give EITHER an <apk> OR --bundle, not both."

# --- Injection-safe validation of remote inputs (no eval, ever) --------------
# Host may be user@host or host. Neither may start with '-' (would look like an
# ssh option) or contain shell/option metacharacters.
REMOTE_USER=""; REMOTE_HOST=""
if [[ -n "${HOSTSPEC}" ]]; then
  if [[ "${HOSTSPEC}" == *"@"* ]]; then
    REMOTE_USER="${HOSTSPEC%@*}"; REMOTE_HOST="${HOSTSPEC##*@}"
    [[ "${REMOTE_USER}" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]*$ ]] || fail "Invalid SSH user in --host."
  else
    REMOTE_HOST="${HOSTSPEC}"
  fi
  [[ "${REMOTE_HOST}" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fail "Invalid SSH host in --host (letters/digits/dot/hyphen; no leading '-')."
fi
if [[ "${DRY_RUN}" -eq 0 ]]; then
  [[ -n "${REMOTE_HOST}" ]]       || fail "--host is required (or use --dry-run)."
  [[ -n "${REMOTE_DOWNLOADS}" ]]  || fail "--remote-downloads is required (or use --dry-run)."
fi
if [[ -n "${REMOTE_DOWNLOADS}" ]]; then
  [[ "${REMOTE_DOWNLOADS}" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "--remote-downloads must be an absolute path (letters/digits/._-/ only)."
  [[ "${REMOTE_DOWNLOADS}" != *".."* ]]              || fail "--remote-downloads must not contain '..'."
  REMOTE_DOWNLOADS="${REMOTE_DOWNLOADS%/}"
fi
if [[ -n "${PORT}" ]]; then
  [[ "${PORT}" =~ ^[0-9]+$ ]] && (( PORT >= 1 && PORT <= 65535 )) || fail "--port must be 1..65535."
fi
if [[ -n "${IDENTITY}" ]]; then
  [[ -f "${IDENTITY}" ]] || fail "--identity file not found (path withheld)."
fi

# --- SSH/SCP option arrays (no StrictHostKeyChecking=no; key/agent only) ------
# BatchMode=yes: never prompt for a password and fail closed on an unknown host
# key (host-key verification stays ENABLED via the caller's known_hosts).
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)
SCP_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)
[[ -n "${PORT}" ]]     && { SSH_OPTS+=(-p "${PORT}");  SCP_OPTS+=(-P "${PORT}"); }
[[ -n "${IDENTITY}" ]] && { SSH_OPTS+=(-i "${IDENTITY}"); SCP_OPTS+=(-i "${IDENTITY}"); }
TARGET="${REMOTE_USER:+${REMOTE_USER}@}${REMOTE_HOST}"

# --- Stage A: obtain a verified bundle ---------------------------------------
BUNDLE_CREATED=0
cleanup_local() { (( BUNDLE_CREATED == 1 )) && rm -rf "${BUNDLE_ROOT}" 2>/dev/null || true; }
trap cleanup_local EXIT

if [[ -n "${APK_SRC}" ]]; then
  [[ -f "${PUBLISH}" ]] || fail "Missing ${PUBLISH}."
  [[ "${WIZER_ANDROID_EXPECTED_CERT_SHA256:-}" ]] \
    || fail "WIZER_ANDROID_EXPECTED_CERT_SHA256 is required to verify the APK on this trusted machine."
  BUNDLE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/wizer-bundle.XXXXXX")"; BUNDLE_CREATED=1
  log "Verifying + building bundle on this trusted machine (apksigner/package/cert/scheme)..."
  # publish-android-release.sh performs the full cryptographic verification and
  # writes the versioned APK + .sha256 + per-version .json + latest.json.
  "${PUBLISH}" "${APK_SRC}" --downloads-dir "${BUNDLE_ROOT}" >/dev/null \
    || fail "Verification/bundle build failed (wrong key, wrong package, unsigned, etc.)."
  BUNDLE_ANDROID="${BUNDLE_ROOT}/android"
else
  # Pre-built bundle: accept either the bundle root (containing android/) or the
  # android/ dir itself. No SDK verification here — the bytes were verified when
  # the bundle was produced; we still re-check the checksum locally + on the VPS.
  [[ -d "${BUNDLE_IN}" ]] || fail "--bundle dir not found: ${BUNDLE_IN}"
  if [[ -d "${BUNDLE_IN}/android" ]]; then BUNDLE_ANDROID="${BUNDLE_IN}/android"; else BUNDLE_ANDROID="${BUNDLE_IN}"; fi
fi

# --- Locate + validate exactly one versioned APK in the bundle ---------------
shopt -s nullglob
apks=("${BUNDLE_ANDROID}"/wizer-signage-v*-*.apk)
shopt -u nullglob
(( ${#apks[@]} == 1 )) || fail "Expected exactly one wizer-signage-v*-*.apk in the bundle, found ${#apks[@]}."
APK_PATH="${apks[0]}"
FN="$(basename "${APK_PATH}")"
# SECURITY: in --bundle mode the bundle (hence this filename) may be externally
# produced, and FN is later passed to the remote login shell (ssh arg-join +
# re-parse). Enforce the canonical safe charset NOW, before any ssh/scp use, so
# a name like `wizer-signage-v1;id;-2.apk` cannot inject commands on the VPS.
[[ "${FN}" =~ ^wizer-signage-v[A-Za-z0-9._-]+-[0-9]+\.apk$ ]] \
  || fail "Unsafe/unexpected APK filename in bundle: ${FN}"
[[ -f "${APK_PATH}" && ! -L "${APK_PATH}" ]] || fail "Bundle APK must be a regular file (no symlinks)."
SUM_PATH="${BUNDLE_ANDROID}/${FN}.sha256"
VER_JSON="${BUNDLE_ANDROID}/${FN%.apk}.json"
LATEST_JSON="${BUNDLE_ANDROID}/latest.json"
for f in "${SUM_PATH}" "${VER_JSON}" "${LATEST_JSON}"; do
  [[ -f "${f}" && ! -L "${f}" ]] || fail "Bundle is missing/!regular: ${f}"
done

# Derive + validate versionCode from the (canonical, verified) filename.
VC="${FN##*-}"; VC="${VC%.apk}"
[[ "${VC}" =~ ^[0-9]+$ ]] || fail "Could not derive a numeric versionCode from ${FN}."

# --- Local integrity gate: re-verify checksum + latest.json consistency ------
if command -v sha256sum >/dev/null 2>&1; then ( cd "${BUNDLE_ANDROID}" && sha256sum -c "${FN}.sha256" >/dev/null ) || fail "Local bundle checksum mismatch."
elif command -v shasum >/dev/null 2>&1;   then ( cd "${BUNDLE_ANDROID}" && shasum -a 256 -c "${FN}.sha256" >/dev/null ) || fail "Local bundle checksum mismatch."
else fail "Neither sha256sum nor shasum on this machine."; fi
# latest.json must be valid JSON and point at this exact APK (guards a stale/
# multi-version bundle). python3 is a trusted-machine tool only.
if command -v python3 >/dev/null 2>&1; then
  FN_ENV="${FN}" python3 -c 'import json,os,sys
d=json.load(open(sys.argv[1]))
assert d.get("fileName")==os.environ["FN_ENV"], "latest.json fileName != bundle APK"
assert d.get("downloadUrl","").startswith("/api/downloads/android/"), "bad downloadUrl"
assert ".." not in d.get("downloadUrl",""), "downloadUrl traversal"' "${LATEST_JSON}" \
    || fail "Bundle latest.json is invalid or does not point at ${FN}."
fi

log "Bundle verified: ${FN} (versionCode ${VC})."

if (( DRY_RUN == 1 )); then
  log "--dry-run: no SSH performed. Bundle ready at ${BUNDLE_ANDROID}"
  log "Would deploy to ${TARGET:-<host>}:${REMOTE_DOWNLOADS:-<remote-downloads>}/android/"
  # keep the bundle for inspection on dry-run
  BUNDLE_CREATED=0
  exit 0
fi

# --- Stage B: authenticated transfer + remote atomic publish -----------------
# 1) Make a UNIQUE remote staging dir under the downloads root (NOT under
#    android/, so nginx never serves it and the live release is untouched).
log "Connecting to ${TARGET} ..."
# Also reap any staging dirs leaked by a prior interrupted deploy (>60 min old);
# they are never served (dotfile, outside android/), this is just housekeeping.
REMOTE_STAGING="$(ssh "${SSH_OPTS[@]}" "${TARGET}" "mkdir -p '${REMOTE_DOWNLOADS}' && find '${REMOTE_DOWNLOADS}' -maxdepth 1 -type d -name '.deploy.*' -mmin +60 -exec rm -rf {} + 2>/dev/null; mktemp -d '${REMOTE_DOWNLOADS}/.deploy.XXXXXX'")" \
  || fail "SSH failed (auth/host-key/connectivity). Ensure your key is authorized and the host key is known."
# Install the cleanup trap BEFORE validating the returned path, so even a
# rejected/odd path still gets its (possibly-created) staging dir removed.
remote_cleanup() { [[ -n "${REMOTE_STAGING:-}" ]] && ssh "${SSH_OPTS[@]}" "${TARGET}" "rm -rf -- '${REMOTE_STAGING}'" >/dev/null 2>&1 || true; cleanup_local; }
trap remote_cleanup EXIT
[[ "${REMOTE_STAGING}" == "${REMOTE_DOWNLOADS}/.deploy."* && "${REMOTE_STAGING}" != *".."* ]] \
  || fail "Unexpected remote staging path returned; aborting."

# 2) Copy the 4 bundle files into staging (final names, but in the isolated
#    staging dir — NEVER directly into the public android/ dir).
log "Transferring bundle to staging ..."
scp "${SCP_OPTS[@]}" \
  "${APK_PATH}" "${SUM_PATH}" "${VER_JSON}" "${LATEST_JSON}" \
  "${TARGET}:${REMOTE_STAGING}/" >/dev/null || fail "scp transfer failed."

# 3) Remote atomic publish — POSIX sh, minimal tools only. Args are passed as
#    positional parameters (validated charsets; no interpolation into code).
log "Publishing atomically on the VPS (re-verify checksum, downgrade/overwrite guard, latest.json last) ..."
# `if ! ssh ...; then fail; fi` keeps the ssh call exempt from set -e AND runs
# the custom message + cleanup trap on a remote non-zero exit, while falling
# through on success. The remote also prints its own reason (ssh forwards it).
if ! ssh "${SSH_OPTS[@]}" "${TARGET}" sh -s -- "${REMOTE_DOWNLOADS}" "${REMOTE_STAGING}" "${FN}" <<'REMOTE'
set -eu
RD="$1"; STAGING="$2"; FN="$3"
ANDROID="$RD/android"

# FN must be the canonical, safe filename.
case "$FN" in
  wizer-signage-v*-*.apk) ;;
  *) echo "remote: unsafe/unknown APK filename: $FN" >&2; exit 7 ;;
esac
case "$FN" in */*|*..*) echo "remote: filename traversal: $FN" >&2; exit 7 ;; esac
VC="${FN##*-}"; VC="${VC%.apk}"
case "$VC" in ''|*[!0-9]*) echo "remote: non-numeric versionCode in $FN" >&2; exit 7 ;; esac

VER_JSON="${FN%.apk}.json"
mkdir -p "$ANDROID"

# Serialize publications; hold the lock across the version check AND the moves.
LOCK="$RD/.publish-android.lock"
exec 9>"$LOCK"
if ! flock -w 30 9; then echo "remote: could not acquire publish lock (another deploy running?)" >&2; exit 3; fi

# Re-verify the transferred APK against its shipped checksum.
( cd "$STAGING" && sha256sum -c "$FN.sha256" >/dev/null 2>&1 ) \
  || { echo "remote: APK checksum verification FAILED after transfer" >&2; exit 4; }

# Downgrade floor = highest versionCode already published on disk (filenames).
maxvc=-1
for f in "$ANDROID"/wizer-signage-v*-*.apk; do
  [ -e "$f" ] || continue
  b="${f##*/}"; c="${b##*-}"; c="${c%.apk}"
  case "$c" in ''|*[!0-9]*) continue ;; esac
  [ "$c" -gt "$maxvc" ] && maxvc="$c"
done
if [ "$maxvc" -ge 0 ] && [ "$VC" -le "$maxvc" ]; then
  echo "remote: refusing downgrade/duplicate: versionCode $VC <= highest published $maxvc" >&2; exit 5
fi

# Never overwrite an existing version's files.
for x in "$FN" "$FN.sha256" "$VER_JSON"; do
  if [ -e "$ANDROID/$x" ]; then echo "remote: refusing to overwrite existing $x" >&2; exit 6; fi
done

# Roll back partially-moved files if we die before latest.json is in place, so
# an interrupted publish (SSH drop / error / TERM) never leaves an orphan
# versioned APK that would permanently block re-deploying that version. On full
# success MOVED is cleared so nothing is removed. (A hard kill / power loss
# can't run this; the 60-min stale-staging sweep + immutable re-deploy cover
# that residual case.)
MOVED=""
rollback() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ -n "$MOVED" ]; then
    for m in $MOVED; do rm -f "$ANDROID/$m" 2>/dev/null || true; done
  fi
  return "$rc"   # preserve the original status (set -e + EXIT trap would else exit 1)
}
trap rollback EXIT HUP INT TERM

# Atomic publish (mv = rename). Immutable files first; latest.json LAST.
mv "$STAGING/$FN"         "$ANDROID/$FN";         MOVED="$FN"
mv "$STAGING/$FN.sha256"  "$ANDROID/$FN.sha256";  MOVED="$MOVED $FN.sha256"
mv "$STAGING/$VER_JSON"   "$ANDROID/$VER_JSON";   MOVED="$MOVED $VER_JSON"
mv "$STAGING/latest.json" "$ANDROID/latest.json"
MOVED=""  # publish complete — do not roll back

echo "remote: published $FN (versionCode $VC); latest.json updated."
REMOTE
then
  fail "Remote publish failed; the live release + latest.json are unchanged (see the 'remote:' message above)."
fi

# 4) trap cleans the remote staging + local bundle.
log "Deployed. Public URLs:"
log "  https://${REMOTE_HOST}/api/downloads/android/${FN}"
log "  https://${REMOTE_HOST}/api/downloads/android/latest.json"
log "Verify over HTTPS: curl -fsS https://${REMOTE_HOST}/api/downloads/android/latest.json"
