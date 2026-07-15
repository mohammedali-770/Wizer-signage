#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — first-boot TLS bootstrap
# =============================================================================
# Seeds a SHORT-LIVED self-signed placeholder certificate into the Let's Encrypt
# volume so Nginx can start on :443 BEFORE a real certificate has been issued.
# Without this, the :443 server block references a missing cert and Nginx exits
# with "[emerg] cannot load certificate", which also blocks the ACME HTTP-01
# challenge on :80 (chicken-and-egg).
#
# Run this ONCE on a fresh server, BEFORE `docker compose ... up -d`. It is safe
# to re-run: it refreshes the placeholder but REFUSES to overwrite a real
# (CA-issued) certificate unless you pass --force.
#
# USAGE:
#   scripts/bootstrap-self-signed-cert.sh <APP_DOMAIN> [--force]
#   APP_DOMAIN=wizer.sa scripts/bootstrap-self-signed-cert.sh
#
# Then issue the real certificate (see docs/nginx-ssl.md) and reload Nginx.
#
# REQUIREMENTS: docker. The Let's Encrypt volume name is read from the compose
# file (not assumed); override with LETSENCRYPT_VOLUME if you customised it.
# =============================================================================

set -euo pipefail

# --- Resolve repo root relative to this script -------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/infra/docker/docker-compose.yml}"

# --- Load .env (without overriding already-exported vars) for APP_DOMAIN ------
ENV_FILE="${ROOT_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

# --- Parse args --------------------------------------------------------------
FORCE=0
ARG_DOMAIN=""
for arg in "$@"; do
  case "${arg}" in
    --force) FORCE=1 ;;
    -h|--help)
      echo "Usage: $0 <APP_DOMAIN> [--force]"; exit 0 ;;
    *) ARG_DOMAIN="${arg}" ;;
  esac
done

# Precedence: positional arg > APP_DOMAIN env / .env value.
DOMAIN="${ARG_DOMAIN:-${APP_DOMAIN:-}}"
if [[ -z "${DOMAIN}" ]]; then
  echo "ERROR: APP_DOMAIN is required." >&2
  echo "  $0 wizer.sa   (or set APP_DOMAIN in ${ENV_FILE})" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed/available." >&2
  exit 1
fi

# --- Resolve the Let's Encrypt volume name from compose (do NOT assume) -------
# Read the explicit `name:` under the top-level `volumes.letsencrypt` key.
detect_volume() {
  awk '
    /^volumes:/        { invol=1; next }
    invol && /^[^[:space:]]/ { invol=0 }          # left the volumes: block
    invol && /^[[:space:]]+letsencrypt:[[:space:]]*$/ { inle=1; next }
    inle && /^[[:space:]]+[a-zA-Z0-9_-]+:[[:space:]]*$/ { inle=0 } # next sibling key
    inle && /name:/ { gsub(/[",]/,"",$2); print $2; exit }
  ' "${COMPOSE_FILE}" 2>/dev/null
}

VOLUME="${LETSENCRYPT_VOLUME:-}"
VOLUME_SOURCE="LETSENCRYPT_VOLUME env"
if [[ -z "${VOLUME}" ]]; then
  VOLUME="$(detect_volume || true)"
  VOLUME_SOURCE="compose ${COMPOSE_FILE}"
fi
if [[ -z "${VOLUME}" ]]; then
  VOLUME="wizer-signage-letsencrypt"
  VOLUME_SOURCE="default fallback"
  echo "WARN: could not read the letsencrypt volume name from compose; using default '${VOLUME}'." >&2
fi

echo "[bootstrap] domain : ${DOMAIN}"
echo "[bootstrap] volume : ${VOLUME}  (from ${VOLUME_SOURCE})"
echo "[bootstrap] force  : $([[ "${FORCE}" == "1" ]] && echo yes || echo no)"

# --- Seed the placeholder inside the volume (idempotent, real-cert-safe) ------
# All cert logic runs INSIDE a throwaway alpine container that mounts the volume,
# because a named volume is only writable by mounting it. `-i` forwards the
# heredoc on stdin to the container's `sh -s` (no `-t`: not interactive).
docker run --rm -i \
  -e APP_DOMAIN="${DOMAIN}" \
  -e FORCE="${FORCE}" \
  -v "${VOLUME}:/etc/letsencrypt" \
  alpine sh -s <<'INNER'
set -e
apk add --no-cache openssl >/dev/null 2>&1
DIR="/etc/letsencrypt/live/${APP_DOMAIN}"
CRT="${DIR}/fullchain.pem"
KEY="${DIR}/privkey.pem"
RENEWAL="/etc/letsencrypt/renewal/${APP_DOMAIN}.conf"
mkdir -p "${DIR}"

# Detect a REAL (certbot-managed) certificate WITHOUT parsing cert internals
# (robust across openssl/libressl). certbot always writes a renewal config and
# manages live/ as symlinks into archive/; our placeholder does neither. If
# either marker is present, refuse to overwrite unless --force.
if [ "${FORCE}" != "1" ]; then
  if [ -f "${RENEWAL}" ] || [ -L "${CRT}" ]; then
    echo "[bootstrap] A certbot-managed certificate already exists for ${APP_DOMAIN}."
    echo "[bootstrap] Refusing to overwrite it. Re-run with --force ONLY if you intend to replace it."
    exit 0
  fi
fi

openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -keyout "${KEY}" -out "${CRT}" -subj "/CN=${APP_DOMAIN}" >/dev/null 2>&1
echo "[bootstrap] Wrote a 1-day self-signed placeholder: ${CRT}"
INNER

cat <<EOF

[bootstrap] Done. Next steps:
  1) Start the stack (Nginx can now boot on :443 with the placeholder):
       docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} up -d
  2) Issue the REAL Let's Encrypt certificate (see docs/nginx-ssl.md), e.g.:
       sudo certbot certonly --webroot \\
         -w /var/lib/docker/volumes/wizer-signage-certbot-webroot/_data \\
         -d "${DOMAIN}" --email "\${LETSENCRYPT_EMAIL:-ops@wizer.sa}" \\
         --agree-tos --no-eff-email --force-renewal
  3) Reload Nginx to pick up the real certificate:
       docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} exec nginx nginx -t \\
         && docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} exec nginx nginx -s reload
EOF
