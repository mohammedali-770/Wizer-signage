#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — Local development bootstrap
# =============================================================================
# Convenience script to get a developer up and running:
#   1. Create .env from .env.example if it is missing.
#   2. Install workspace dependencies (pnpm).
#   3. Start all apps in dev mode (turbo / pnpm dev).
#
# REQUIREMENTS:
#   - bash, pnpm, Node >= 22.18.0 (root engines + .npmrc engine-strict, so the
#     `pnpm install` below hard-fails on older Node rather than warning)
#
# Windows users: run this from Git Bash or WSL, or run the equivalent pnpm
# commands directly in PowerShell (pnpm install; pnpm dev).
# =============================================================================

set -euo pipefail

# --- Resolve repo root relative to this script -------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"

# --- 1. Ensure .env exists ---------------------------------------------------
if [[ ! -f ".env" ]]; then
  if [[ -f ".env.example" ]]; then
    echo "==> [dev] No .env found — copying from .env.example"
    cp ".env.example" ".env"
    echo "==> [dev] Created .env. Review and fill in the required values."
  else
    echo "==> [dev] WARNING: neither .env nor .env.example found." >&2
  fi
else
  echo "==> [dev] .env already exists — leaving it untouched."
fi

# --- 2. Install dependencies -------------------------------------------------
if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm not found. Install it (corepack enable && corepack prepare pnpm@9 --activate)." >&2
  exit 1
fi

echo "==> [dev] Installing dependencies (pnpm install)..."
pnpm install

# --- 3. Start dev servers ----------------------------------------------------
echo "==> [dev] Starting development servers (pnpm dev)..."
pnpm dev
