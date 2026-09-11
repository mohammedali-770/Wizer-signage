#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — locating Android SDK build-tools across platforms
# =============================================================================
# The production signing keystore lives on the owner's Windows laptop and never
# leaves it (docs/android-signing.md §4-§5), so the signing and publishing
# scripts necessarily run under Git Bash on Windows. Two things differ there and
# both were found the hard way:
#
#  1. Windows build-tools ship `apksigner.bat` and `aapt2.exe`. There is no
#     extensionless `apksigner` at all, so `[[ -x "${d}/apksigner" ]]` matches
#     nothing and the scripts aborted with "install build-tools" against a
#     complete SDK.
#
#  2. apksigner.bat resolves its own directory and re-invokes through cmd
#     WITHOUT quoting it. With a profile like "C:\Users\Mohammed Ali" the path
#     splits at the space:
#       'C:\Users\Mohammed' is not recognized as an internal or external command
#     That surfaced only AFTER a correctly signed APK had been produced, so it
#     read as a signing failure when signing had worked.
#
# lib/apksigner.jar ships in every build-tools release and is exactly what both
# platform wrappers invoke, so calling it directly sidesteps the wrapper.
# =============================================================================

# android_bt_tool <build-tools-dir> <name> -> prints a usable path, or returns 1
#
# `-x` is deliberately NOT required for .bat/.exe: the executable bit is not
# meaningful for them under Git Bash/MSYS and testing it rejects files that run
# perfectly well. For the extensionless Unix form it IS required, so a
# present-but-not-executable file is still refused.
android_bt_tool() {
  local dir="$1" name="$2" cand
  for cand in "${dir}/${name}" "${dir}/${name}.bat" "${dir}/${name}.exe"; do
    [[ -f "${cand}" ]] || continue
    case "${cand}" in
      *.bat|*.exe) printf '%s' "${cand}"; return 0 ;;
      *) if [[ -x "${cand}" ]]; then printf '%s' "${cand}"; return 0; fi ;;
    esac
  done
  return 1
}

# android_resolve_build_tools [fail-fn]
#
# Sets, in the CALLER's scope:
#   BUILD_TOOLS_DIR   newest build-tools dir that actually contains apksigner
#   APKSIGNER_CMD     array: the jar via java when available, else the wrapper
#   AAPT              aapt, else aapt2, in whatever form this platform ships
#
# Returns 1 with a message on stderr if anything is missing, so each caller can
# route that through its own fail().
android_resolve_build_tools() {
  local sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  if [[ -z "${sdk_root}" || ! -d "${sdk_root}" ]]; then
    echo "ANDROID_HOME / ANDROID_SDK_ROOT is not set to a valid Android SDK." >&2
    return 1
  fi

  BUILD_TOOLS_DIR=""
  local found=""
  if [[ -d "${sdk_root}/build-tools" ]]; then
    local d
    while IFS= read -r d; do
      if found="$(android_bt_tool "${d}" apksigner)"; then
        BUILD_TOOLS_DIR="${d}"; break
      fi
    done < <(find "${sdk_root}/build-tools" -maxdepth 1 -mindepth 1 -type d | sort -Vr)
  fi
  if [[ -z "${BUILD_TOOLS_DIR}" ]]; then
    echo "Could not find apksigner (or apksigner.bat/.exe) under ${sdk_root}/build-tools. Install Android build-tools." >&2
    return 1
  fi

  APKSIGNER_CMD=()
  if [[ -f "${BUILD_TOOLS_DIR}/lib/apksigner.jar" ]] && command -v java >/dev/null 2>&1; then
    APKSIGNER_CMD=(java -jar "${BUILD_TOOLS_DIR}/lib/apksigner.jar")
  else
    APKSIGNER_CMD=("${found}")
  fi

  AAPT="$(android_bt_tool "${BUILD_TOOLS_DIR}" aapt || true)"
  [[ -n "${AAPT}" ]] || AAPT="$(android_bt_tool "${BUILD_TOOLS_DIR}" aapt2 || true)"
  if [[ -z "${AAPT}" ]]; then
    echo "Could not find aapt/aapt2 (or their .exe) under ${BUILD_TOOLS_DIR}." >&2
    return 1
  fi
  return 0
}
