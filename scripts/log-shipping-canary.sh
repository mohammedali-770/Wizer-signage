#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — off-box log-shipping canary
# =============================================================================
# Emits ONE structured line to stdout on a schedule. The maintenance container
# ships stdout through the Docker fluentd driver (see
# infra/docker/docker-compose.log-shipping.yml), so this line traverses the
# entire delivery path: Docker daemon -> network -> collector -> ingest.
#
# WHY THIS EXISTS:
#   `fluentd-async: 'true'` means a collector that is unreachable, misconfigured
#   or dead costs nothing observable. The container starts, stays healthy,
#   `docker logs` looks completely normal, and the Docker daemon logs no
#   complaint — while zero lines leave the host. Measured during the off-box
#   logging drill: a wrong LOG_SHIPPING_ADDRESS delivered 0 of 33 lines with no
#   signal anywhere, and a ten-second collector outage under load silently
#   dropped 2945 of 4000 lines once the buffer filled.
#
#   Nothing on this host can raise that alarm credibly, for the same reason the
#   backup has an external dead-man switch: the container that would report the
#   failure is inside the failure. So the alarm belongs on the COLLECTOR, which
#   is the one component positioned to notice the absence.
#
# OPERATOR SETUP (required — this script is only half the mechanism):
#   Configure a rule on the log collector that pings a dead-man URL whenever it
#   RECEIVES a line containing LOG_CANARY_MARKER below. An external dead-man
#   service then alerts when those pings stop. Set the alert threshold to at
#   least three times the cron interval so one missed tick is not a page.
#   See docs/observability.md, "Proving logs still leave the host".
#
# This script always exits 0. A non-zero exit would only be visible in the log
# stream whose health is in question, so failure is signalled by ABSENCE at the
# collector, never by a status code here.
# =============================================================================

set -uo pipefail

# Stable, greppable and unlikely to collide with application output. Changing it
# silently breaks the operator's collector rule, so it is pinned by
# apps/api/src/common/security/maintenance-runtime.spec.ts.
LOG_CANARY_MARKER='wizer.log-shipping.canary'

# The collector parses these lines as JSON, so a quote, backslash or newline in
# an interpolated value would emit a malformed record and quietly break the
# dead-man rule that matches on it. IMAGE_TAG comes from the deploy environment
# and the hostname from the container runtime; neither is guaranteed benign, and
# a canary that emits invalid JSON fails in the one way nothing else would catch.
# Restricting to a conservative charset guarantees a well-formed line.
json_safe() {
  printf '%s' "${1}" | tr -cd 'A-Za-z0-9._:+-' | cut -c1-128
}

CANARY_HOST="$(json_safe "$(hostname 2>/dev/null || echo unknown)")"
CANARY_RELEASE="$(json_safe "${IMAGE_TAG:-unknown}")"
[ -n "${CANARY_HOST}" ] || CANARY_HOST=unknown
[ -n "${CANARY_RELEASE}" ] || CANARY_RELEASE=unknown

printf '{"level":"info","logger":"log-shipping-canary","marker":"%s","host":"%s","at":"%s","release":"%s"}\n' \
  "${LOG_CANARY_MARKER}" \
  "${CANARY_HOST}" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "${CANARY_RELEASE}"

exit 0
