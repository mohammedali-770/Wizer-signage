#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — load a dotenv file as DEFAULTS, not as overrides
# =============================================================================
# `set -a; source .env; set +a` is the obvious way to read a dotenv file and the
# wrong one: it OVERWRITES variables the caller already exported. The dotenv
# contract is the other way round -- the file supplies defaults, the caller
# overrides them -- and the difference is not cosmetic.
#
# Verified 2026-09-10: an operator who exports a scratch DIRECT_URL and runs a
# maintenance script has it silently replaced by the production URL, and the
# scripts deliberately never echo the URL, so there is no indication the target
# was swapped. scripts/ensure-telemetry-partitions.sh then applies DDL.
#
# The names to protect are passed EXPLICITLY rather than shielding everything
# the file assigns. Blanket "caller always wins" would silently change which
# value a dozen unrelated variables resolve to, in contexts (deploy, cron,
# container) that are hard to enumerate; naming them keeps the blast radius
# equal to the intent.
# =============================================================================

# env_load_defaults <env-file> [VAR ...]
#
# Sources <env-file> with automatic export, then restores each named VAR that
# the caller had already set -- including to the empty string, which is a
# deliberate choice and must not be confused with unset.
env_load_defaults() {
  local env_file="$1"
  shift || true
  [ -f "$env_file" ] || return 0

  local -a preset_names=()
  local -A preset_value=()
  local name
  for name in "$@"; do
    if [ -n "${!name+set}" ]; then
      preset_names+=("${name}")
      preset_value["${name}"]="${!name}"
    fi
  done

  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a

  for name in ${preset_names[@]+"${preset_names[@]}"}; do
    printf -v "${name}" '%s' "${preset_value[${name}]}"
    export "${name?}"
    echo "[env] ${name} taken from the environment, not ${env_file}." >&2
  done
  return 0
}
