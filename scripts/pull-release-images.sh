#!/usr/bin/env bash
# Pull one immutable Wizer Signage release from a registry and retag it into
# the canonical local names consumed by docker-compose.yml and rollback.sh.
#
# Usage:
#   IMAGE_REGISTRY_PREFIX=ghcr.io/<owner> scripts/pull-release-images.sh <12-char-sha>
#
# The release workflow stamps org.opencontainers.image.revision=<full git sha>
# into every image. This script refuses an image whose embedded revision does
# not begin with the requested short SHA, so a moved/mis-published tag cannot be
# silently deployed under the wrong release identity.
set -euo pipefail

TAG="${1:-}"
PREFIX="${IMAGE_REGISTRY_PREFIX:-}"
SERVICES=(api dashboard maintenance)

if [[ ! "${TAG}" =~ ^[0-9a-f]{12}$ ]]; then
  echo "ERROR: release tag must be exactly 12 lowercase hexadecimal characters." >&2
  exit 2
fi

if [[ -z "${PREFIX}" ]]; then
  echo "ERROR: IMAGE_REGISTRY_PREFIX is required (for example ghcr.io/<owner>)." >&2
  exit 2
fi

# A registry/image prefix is data passed to docker, never shell-evaluated. Still
# reject whitespace, schemes and trailing slashes because all three are operator
# mistakes that produce ambiguous image references and poor incident messages.
if [[ "${PREFIX}" == *"://"* || "${PREFIX}" =~ [[:space:]] || "${PREFIX}" == */ ]]; then
  echo "ERROR: IMAGE_REGISTRY_PREFIX must be a Docker registry/repository prefix without scheme, whitespace, or trailing slash." >&2
  exit 2
fi

for svc in "${SERVICES[@]}"; do
  remote="${PREFIX}/wizer-signage-${svc}:${TAG}"
  local_ref="wizer-signage/${svc}:${TAG}"

  echo "==> [registry] Pulling ${remote} ..."
  docker pull "${remote}"

  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "${remote}" 2>/dev/null || true)"
  if [[ ! "${revision}" =~ ^${TAG}[0-9a-f]{28}$ ]]; then
    echo "ERROR: ${remote} does not carry the expected org.opencontainers.image.revision for ${TAG}." >&2
    echo "       Refusing to retag or deploy an image with an unverified release identity." >&2
    exit 1
  fi

  docker tag "${remote}" "${local_ref}"
  echo "    [registry] verified ${revision}; local tag ${local_ref}"
done

echo "==> [registry] Release ${TAG} is present under all canonical local image names."
