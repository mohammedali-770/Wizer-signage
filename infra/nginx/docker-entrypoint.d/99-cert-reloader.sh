#!/bin/sh
# =============================================================================
# Wizer Signage — periodic nginx reload so renewed TLS certificates take effect
# =============================================================================
# Mounted into the official nginx image's /docker-entrypoint.d/, which runs every
# executable *.sh there BEFORE nginx starts (and after the envsubst templating
# step, so $APP_DOMAIN is already rendered).
#
# WHY THIS EXISTS:
#   nginx reads certificate files into memory once, at startup. certbot renews
#   the files on disk but cannot signal a process in another container without
#   the Docker socket (which we deliberately do not mount). Previously the ONLY
#   thing that reloaded nginx was a deploy — so if no deploy happened inside the
#   ~30-day renew-to-expiry window, the certificate expired with a perfectly
#   valid replacement sitting unused on disk: site-wide HTTPS failure, dashboard
#   unusable, every player failing cert validation.
#
#   A periodic `nginx -s reload` is the simplest robust fix. Reload is graceful
#   (workers finish in-flight requests), so a 6-hour cadence costs nothing and
#   bounds "renewed but not yet served" to at most 6 hours out of a 30-day window.
#
# Override the cadence with NGINX_RELOAD_INTERVAL (seconds).
# =============================================================================
set -eu

INTERVAL="${NGINX_RELOAD_INTERVAL:-21600}" # 6h

# Background: wait for the master process to come up, then reload on a cadence.
# `nginx -s reload` is a no-op-safe signal; failures are tolerated so a transient
# error can never take the container down.
(
  # Give the master process time to write its pid file before the first signal.
  sleep 30
  while :; do
    sleep "$INTERVAL"
    if nginx -s reload 2>/dev/null; then
      echo "[cert-reloader] nginx reloaded (picks up renewed certificates)"
    else
      echo "[cert-reloader] reload signal failed; will retry in ${INTERVAL}s" >&2
    fi
  done
) &

exit 0
