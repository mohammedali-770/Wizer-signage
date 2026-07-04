#!/usr/bin/env bash
# =============================================================================
# Sync host Let's Encrypt certificates into the Docker volume nginx reads from.
# =============================================================================
# WHY: when certbot runs on the HOST it writes certs to
#   /etc/letsencrypt/live/<domain>/
# but the nginx container reads them from the named Docker volume
#   wizer-signage-letsencrypt  (mounted read-only at /etc/letsencrypt).
# Those are two different locations, so freshly issued/renewed certs must be
# copied into the volume and nginx reloaded.
#
# USAGE (manual, after the first issuance):
#   sudo APP_DOMAIN=signage.example.com scripts/sync-letsencrypt-to-docker.sh
#
# USAGE (automatic on renewal) — install as a certbot deploy hook so every
# renewal re-syncs and reloads nginx:
#   sudo install -m 0755 scripts/sync-letsencrypt-to-docker.sh \
#     /etc/letsencrypt/renewal-hooks/deploy/wizer-signage-sync-docker-nginx.sh
#   # certbot sets RENEWED_LINEAGE / RENEWED_DOMAINS when it invokes the hook.
#
# Requires: root (writes to the docker volume dir, runs docker), docker CLI.
# No secrets are stored in this script.
# =============================================================================
set -euo pipefail

DOMAIN="${1:-${APP_DOMAIN:-${RENEWED_DOMAINS:-}}}"
# RENEWED_DOMAINS may be a space-separated list; take the first name.
DOMAIN="${DOMAIN%% *}"

VOLUME="${LETSENCRYPT_VOLUME:-wizer-signage-letsencrypt}"
NGINX_CONTAINER="${NGINX_CONTAINER:-wizer-signage-nginx}"
HOST_LETSENCRYPT_DIR="${HOST_LETSENCRYPT_DIR:-/etc/letsencrypt}"

if [ -z "$DOMAIN" ]; then
  echo "ERROR: domain not provided. Set APP_DOMAIN or pass it as the first arg." >&2
  echo "  sudo APP_DOMAIN=signage.example.com $0" >&2
  exit 1
fi

# When invoked as a certbot deploy hook, RENEWED_LINEAGE points at the live dir.
SRC="${RENEWED_LINEAGE:-$HOST_LETSENCRYPT_DIR/live/$DOMAIN}"
if [ ! -f "$SRC/fullchain.pem" ] || [ ! -f "$SRC/privkey.pem" ]; then
  echo "ERROR: certificate not found under $SRC (fullchain.pem/privkey.pem)." >&2
  exit 1
fi

# Resolve the Docker volume's data directory (do not hardcode the path).
MOUNTPOINT="$(docker volume inspect -f '{{ .Mountpoint }}' "$VOLUME")"
DEST="$MOUNTPOINT/live/$DOMAIN"
mkdir -p "$DEST"

# Let's Encrypt live/ files are symlinks into archive/; -L copies the real
# contents so the volume is self-contained for the container.
cp -L "$SRC/fullchain.pem" "$DEST/fullchain.pem"
cp -L "$SRC/privkey.pem"   "$DEST/privkey.pem"
chmod 644 "$DEST/fullchain.pem"
chmod 600 "$DEST/privkey.pem"
echo "Copied certificate for $DOMAIN into volume '$VOLUME'."

# Validate the config, then hot-reload nginx (no downtime). If nginx isn't
# running yet (first issuance before the stack is up), skip the reload.
if docker ps --format '{{.Names}}' | grep -qx "$NGINX_CONTAINER"; then
  if docker exec "$NGINX_CONTAINER" nginx -t; then
    docker exec "$NGINX_CONTAINER" nginx -s reload
    echo "Validated config and reloaded nginx ($NGINX_CONTAINER)."
  else
    echo "ERROR: 'nginx -t' failed; NOT reloading." >&2
    exit 1
  fi
else
  echo "nginx container '$NGINX_CONTAINER' not running; skipped reload."
fi
