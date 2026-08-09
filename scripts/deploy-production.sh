#!/usr/bin/env bash
# Wizer Signage — preferred production deployment entrypoint.
#
# Keep this wrapper intentionally tiny: production-preflight.sh is read-only and
# fail-closed; deploy-blue-green.sh owns all mutating release logic. Operators
# should invoke THIS command rather than calling deploy-blue-green.sh directly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

printf '==> [production] Running mandatory host/config preflight...\n'
bash "${SCRIPT_DIR}/production-preflight.sh"

printf '==> [production] Preflight passed; handing off to blue/green deployment...\n'
exec bash "${SCRIPT_DIR}/deploy-blue-green.sh" "$@"
