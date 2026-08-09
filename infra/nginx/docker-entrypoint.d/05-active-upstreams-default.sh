#!/bin/sh
# Bootstrap only. Blue/green deploys replace this file atomically and reload
# nginx. A named volume persists the active slot across nginx recreation/reboot.
set -eu

RUNTIME_DIR=/etc/nginx/runtime
ACTIVE_FILE="${RUNTIME_DIR}/active-upstreams.conf"
mkdir -p "${RUNTIME_DIR}"

if [ ! -s "${ACTIVE_FILE}" ]; then
  cat > "${ACTIVE_FILE}.tmp" <<'EOF'
# Legacy-safe bootstrap: existing production services remain the first active slot.
upstream api_upstream {
    server api:3001;
    keepalive 32;
}
upstream dashboard_upstream {
    server dashboard:3000;
    keepalive 32;
}
upstream dashboard_static_upstream {
    server dashboard:3000;
    keepalive 32;
}
EOF
  mv "${ACTIVE_FILE}.tmp" "${ACTIVE_FILE}"
fi
