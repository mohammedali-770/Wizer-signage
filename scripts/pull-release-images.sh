#!/usr/bin/env bash
# Pull one immutable Wizer Signage release from a registry, verify the release
# identity/configuration, then retag it into the canonical local names consumed
# by the production Compose stack.
#
# Usage:
#   IMAGE_REGISTRY_PREFIX=ghcr.io/<owner> scripts/pull-release-images.sh <12-char-sha>
#
# Optional production invariant:
#   EXPECTED_DASHBOARD_API_URL=https://signage.wizer.sa/api
#
# The release workflow stamps org.opencontainers.image.revision=<full git sha>
# into every image and io.wizer.dashboard-api-url=<baked URL> into the dashboard
# image. Production supplies EXPECTED_DASHBOARD_API_URL so an immutable image
# built from the correct commit but with a staging/wrong API URL is rejected.
set -euo pipefail

TAG="${1:-}"
PREFIX="${IMAGE_REGISTRY_PREFIX:-}"
EXPECTED_DASHBOARD_API_URL="${EXPECTED_DASHBOARD_API_URL:-}"
SERVICES=(api dashboard maintenance)

if [[ ! "${TAG}" =~ ^[0-9a-f]{12}$ ]]; then
  echo "ERROR: release tag must be exactly 12 lowercase hexadecimal characters." >&2
  exit 2
fi

if [[ -z "${PREFIX}" ]]; then
  echo "ERROR: IMAGE_REGISTRY_PREFIX is required (for example ghcr.io/<owner>)." >&2
  exit 2
fi

if [[ "${PREFIX}" == *"://"* || "${PREFIX}" =~ [[:space:]] || "${PREFIX}" == */ ]]; then
  echo "ERROR: IMAGE_REGISTRY_PREFIX must be a Docker registry/repository prefix without scheme, whitespace, or trailing slash." >&2
  exit 2
fi

if [[ -n "${EXPECTED_DASHBOARD_API_URL}" ]]; then
  if [[ ! "${EXPECTED_DASHBOARD_API_URL}" =~ ^https://[^[:space:]?#]+/api/?$ ]]; then
    echo "ERROR: EXPECTED_DASHBOARD_API_URL must be a public HTTPS API base ending in /api." >&2
    exit 2
  fi
fi

# Verification is deliberately two-phase: pull and verify EVERY image before
# changing any canonical local tags. A dashboard configuration mismatch must not
# leave a partially promoted API/maintenance release behind.
for svc in "${SERVICES[@]}"; do
  remote="${PREFIX}/wizer-signage-${svc}:${TAG}"

  echo "==> [registry] Pulling ${remote} ..."
  docker pull "${remote}"

  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "${remote}" 2>/dev/null || true)"
  if [[ ! "${revision}" =~ ^${TAG}[0-9a-f]{28}$ ]]; then
    echo "ERROR: ${remote} does not carry the expected org.opencontainers.image.revision for ${TAG}." >&2
    echo "       Refusing to promote an image with an unverified release identity." >&2
    exit 1
  fi

  if [[ "${svc}" == "dashboard" && -n "${EXPECTED_DASHBOARD_API_URL}" ]]; then
    baked_api_url="$(docker image inspect --format '{{ index .Config.Labels "io.wizer.dashboard-api-url" }}' "${remote}" 2>/dev/null || true)"
    if [[ "${baked_api_url}" != "${EXPECTED_DASHBOARD_API_URL}" ]]; then
      echo "ERROR: dashboard image was baked for a different API URL." >&2
      echo "       Expected the host-approved production API URL; refusing to promote this release." >&2
      exit 1
    fi
  fi

done

for svc in "${SERVICES[@]}"; do
  remote="${PREFIX}/wizer-signage-${svc}:${TAG}"
  local_ref="wizer-signage/${svc}:${TAG}"
  docker tag "${remote}" "${local_ref}"
  echo "    [registry] verified and promoted ${local_ref}"
done

echo "==> [registry] Release ${TAG} is verified under all canonical local image names."
