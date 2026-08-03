#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — TLS certificate expiry check
# =============================================================================
# Checks how long the certificate actually SERVED by the public endpoint is
# still valid for, and fails when it drops below a threshold.
#
# Checking the SERVED certificate (not the file on disk) is deliberate: it
# catches BOTH "renewal did not run" and "renewal ran but nginx is still serving
# the old certificate" — the failure mode this stack previously had, because
# nginx loads certificates into memory at startup only and certbot runs in a
# different container.
#
# PORTABILITY: expiry is evaluated with `openssl x509 -checkend`, which needs no
# date parsing. busybox `date -d` (the maintenance image is Alpine) cannot parse
# OpenSSL's "Sep 20 20:04:47 2026 GMT" format, so any date-math approach would
# silently fail there.
#
# USAGE:
#   scripts/check-cert-expiry.sh [domain] [warn_days]
#   APP_DOMAIN=signage.example.com scripts/check-cert-expiry.sh
#
# Exit codes: 0 = OK, 1 = below threshold / could not determine.
# Intended to run from the maintenance crontab; the non-zero exit and stderr are
# what surface in `docker logs`.
# =============================================================================
set -euo pipefail

DOMAIN="${1:-${APP_DOMAIN:-}}"
WARN_DAYS="${2:-${CERT_WARN_DAYS:-21}}"

if [[ -z "${DOMAIN}" ]]; then
  echo "ERROR: no domain given (pass an argument or set APP_DOMAIN)." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl not found; cannot check certificate expiry." >&2
  exit 1
fi

# Fetch the leaf certificate from the live TLS endpoint. </dev/null closes stdin
# so s_client returns instead of waiting for input; the timeout bounds a hung
# handshake. SNI (-servername) is required — nginx serves by server_name.
cert="$(
  timeout 15 openssl s_client -servername "${DOMAIN}" -connect "${DOMAIN}:443" </dev/null 2>/dev/null |
    openssl x509 2>/dev/null || true
)"

if [[ -z "${cert}" ]]; then
  echo "ERROR: could not retrieve a certificate from ${DOMAIN}:443 (endpoint down, DNS, or TLS failure)." >&2
  exit 1
fi

# Raw expiry string, printed for humans only — never parsed (see PORTABILITY).
not_after="$(printf '%s' "${cert}" | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"

# `-checkend N` exits 0 when the certificate is still valid N seconds from now.
if ! printf '%s' "${cert}" | openssl x509 -noout -checkend $(( WARN_DAYS * 86400 )) >/dev/null 2>&1; then
  # Below threshold — narrow down how bad it is so the log says something useful.
  remaining="fewer than ${WARN_DAYS}"
  for d in $(seq 0 "$(( WARN_DAYS - 1 ))"); do
    if printf '%s' "${cert}" | openssl x509 -noout -checkend $(( d * 86400 )) >/dev/null 2>&1; then
      continue
    fi
    remaining="${d}"
    break
  done

  echo "ALERT: TLS certificate for ${DOMAIN} expires in ${remaining} day(s) (threshold ${WARN_DAYS})." >&2
  [[ -n "${not_after}" ]] && echo "       notAfter: ${not_after}" >&2
  echo "       Renewal may not be running, or nginx may still be serving the old certificate." >&2
  echo "       Check: docker compose -f infra/docker/docker-compose.yml exec nginx nginx -s reload" >&2
  exit 1
fi

echo "[cert-check] ${DOMAIN}: valid for more than ${WARN_DAYS} day(s)${not_after:+ (notAfter: ${not_after})} — OK"
