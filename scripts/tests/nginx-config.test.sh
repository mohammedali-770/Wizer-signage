#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — Nginx configuration regression tests
# =============================================================================
# Renders the env-substituted server template exactly as the nginx image does
# and validates the result with the REAL `nginx -t`, then asserts the properties
# that are easy to break silently.
#
# "Silently" is the point. Every finding pinned here was a directive that was
# present and read correctly but did nothing:
#   - `keepalive 32` pools that never held a connection because nginx sends
#     `Connection: close` upstream unless told otherwise.
#   - a `proxy_cache_valid` with no cache zone behind it.
# Neither produces a warning. `nginx -t` reports them as valid config, because
# they ARE valid config — they just don't do what the line says.
#
# Requires docker (the same nginx image the stack runs). Skips cleanly without.
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

NGINX_CONF="${ROOT_DIR}/infra/nginx/nginx.conf"
TEMPLATE="${ROOT_DIR}/infra/nginx/templates/wizer-signage.conf.template"

# Reserved-for-documentation domain (RFC 2606). Never a real Wizer hostname:
# the deployed domain comes from APP_DOMAIN at runtime, and baking one into a
# test would be the first step toward baking one into the config.
TEST_DOMAIN="signage.example.com"
NGINX_IMAGE="${NGINX_IMAGE:-nginx:1.29-alpine}"

pass=0
fail=0

ok()   { printf '  ok   %s\n' "$1"; pass=$(( pass + 1 )); }
bad()  { printf '  FAIL %s\n' "$1"; fail=$(( fail + 1 )); }

check() { # check <description> <condition-exit-code>
  if [[ "$2" -eq 0 ]]; then ok "$1"; else bad "$1"; fi
}

echo "==> nginx configuration regression tests"

for f in "${NGINX_CONF}" "${TEMPLATE}"; do
  if [[ ! -f "${f}" ]]; then
    echo "FAIL: missing ${f}" >&2
    exit 1
  fi
done

# --- Rendered template -------------------------------------------------------
# The nginx image runs envsubst over /etc/nginx/templates/*.template with
# NGINX_ENVSUBST_FILTER restricting substitution to APP_DOMAIN, so nginx's own
# runtime variables ($host, $request_id, ...) survive. Reproduce exactly that.
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

RENDERED="${WORK}/wizer-signage.conf"
APP_DOMAIN="${TEST_DOMAIN}" \
  perl -pe 's/\$\{APP_DOMAIN\}/$ENV{APP_DOMAIN}/g' "${TEMPLATE}" > "${RENDERED}"

# Directive assertions must run against DIRECTIVES, not prose. These files are
# heavily commented, and several comments name the very directives being
# asserted about ("there is deliberately no proxy_cache_valid here"), so a naive
# grep over the raw file matches the explanation instead of the config and
# reports the opposite of the truth.
DIRECTIVES="${WORK}/directives.conf"
NGINX_DIRECTIVES="${WORK}/nginx-directives.conf"
strip_comments() { sed -e 's/#.*$//' "$1"; }

check "template renders with no \${APP_DOMAIN} placeholders left" \
  "$(grep -qF '${APP_DOMAIN}' "${RENDERED}"; echo $((1 - $?)))"

check "rendering substitutes ONLY APP_DOMAIN (nginx runtime vars survive)" \
  "$(grep -q '\$host' "${RENDERED}" && grep -q '\$request_id' "${RENDERED}"; echo $?)"

# --- Static assertions -------------------------------------------------------
# Every location that proxies into a keepalive-enabled upstream must clear the
# Connection header, or the pool is inert.

strip_comments "${RENDERED}"   > "${DIRECTIVES}"
strip_comments "${NGINX_CONF}" > "${NGINX_DIRECTIVES}"

# Sanity-check the stripper itself: if it emptied the files, every assertion
# below would pass vacuously.
check "comment stripping leaves the directives intact" \
  "$([[ $(grep -c 'proxy_pass' "${DIRECTIVES}") -ge 4 ]]; echo $?)"

api_locations=$(awk '/location \/api\//,/^    }/' "${DIRECTIVES}" | grep -c 'proxy_set_header Connection *""')
check "both /api/ locations clear the Connection header (found ${api_locations}/2)" \
  "$([[ "${api_locations}" -eq 2 ]]; echo $?)"

check "/_next/static/ clears the Connection header" \
  "$(awk '/location \/_next\/static\//,/^    }/' "${DIRECTIVES}" | grep -q 'proxy_set_header Connection *""'; echo $?)"

# The dashboard catch-all carries websocket upgrades, so it uses the map rather
# than a literal "". The map's empty branch is what makes keepalive work there.
check "\$connection_upgrade maps the non-upgrade case to \"\" and not close" \
  "$(grep -Ezoq "map \\\$http_upgrade \\\$connection_upgrade \{[^}]*''[[:space:]]+\"\";" "${NGINX_DIRECTIVES}"; echo $?)"

check "no proxy_cache_valid without a proxy_cache_path to back it" \
  "$(! { grep -q 'proxy_cache_valid' "${DIRECTIVES}" && ! grep -q 'proxy_cache_path' "${NGINX_DIRECTIVES}"; }; echo $?)"

check "upstreams still declare keepalive pools" \
  "$(grep -q 'keepalive 32' "${DIRECTIVES}"; echo $?)"

check "proxy_http_version 1.1 is set (keepalive's other precondition)" \
  "$(grep -q 'proxy_http_version 1.1' "${NGINX_DIRECTIVES}"; echo $?)"

# APK downloads stream tens of megabytes per request off a single VPS. The
# generic 30r/s API zone is priced for JSON, not for that: at that rate the
# uplink saturates and every screen's manifest poll fails with it.
dl_blocks=$(grep -c 'zone=wizer_downloads' "${DIRECTIVES}")
check "both /api/downloads/ locations carry the tight rate zone (found ${dl_blocks}/2)" \
  "$([[ "${dl_blocks}" -eq 2 ]]; echo $?)"

check "the downloads zone is declared and is tighter than the API zone" \
  "$(grep -qE 'zone=wizer_downloads:[0-9]+m\s+rate=[0-9]+r/m' "${NGINX_DIRECTIVES}"; echo $?)"

check "the static android subtree is still matched before the proxied one" \
  "$([[ $(grep -n 'location \^~ /api/downloads/android/' "${DIRECTIVES}" | cut -d: -f1) -lt \
        $(grep -n 'location \^~ /api/downloads/ ' "${DIRECTIVES}" | cut -d: -f1) ]]; echo $?)"

# Regression guard for a block that was removed deliberately: the API has no
# WebSocket gateway, and a /ws location proxying to it held a 3600s timeout
# open for an endpoint that never existed.
check "no /ws location (the API has no websocket gateway)" \
  "$(! grep -qE '^\s*location\s+/ws' "${DIRECTIVES}"; echo $?)"

# --- Real nginx -t -----------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  echo "  SKIP nginx -t (docker unavailable)"
else
  # Two things nginx -t needs that only exist in the real stack:
  #
  #  - The certificate files. ssl_certificate is opened at CONFIG-PARSE time,
  #    not on first request, so a missing file is a hard `-t` failure. A
  #    throwaway self-signed pair satisfies it; nothing verifies it here.
  #  - DNS for the upstream hostnames. nginx resolves `server dashboard:3000`
  #    while parsing and aborts with "host not found in upstream" if it cannot.
  #    In production the compose network provides those names. Mapping them to
  #    loopback lets the parse complete — this is a CONFIG test, nothing is
  #    connected to.
  mkdir -p "${WORK}/certs"
  UPSTREAM_HOSTS=(--add-host "dashboard:127.0.0.1" --add-host "api:127.0.0.1")

  if ! command -v openssl >/dev/null 2>&1; then
    echo "  SKIP nginx -t (no openssl to mint the throwaway certificate)"
    echo
    echo "==> ${pass} passed, ${fail} failed"
    exit $(( fail == 0 ? 0 : 1 ))
  fi

  # Throwaway, self-signed, one-day. Generated on the HOST — the nginx image
  # ships no openssl binary, and generating it in the container failed silently,
  # which surfaced only as a confusing "cannot load certificate" from nginx -t.
  # Never trusted by anything, deleted by the EXIT trap.
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
    -subj "/CN=${TEST_DOMAIN}" \
    -keyout "${WORK}/certs/privkey.pem" -out "${WORK}/certs/fullchain.pem" >/dev/null 2>&1

  if [[ ! -s "${WORK}/certs/fullchain.pem" || ! -s "${WORK}/certs/privkey.pem" ]]; then
    bad "could not generate the throwaway certificate that nginx -t requires"
    echo
    echo "==> ${pass} passed, ${fail} failed"
    exit 1
  fi

  # `nginx -t` does not merely parse — it opens the listen sockets. This sandbox
  # and most CI container runtimes have IPv6 disabled at the kernel, so
  # `listen [::]:80` aborts the test with "Address family not supported" no
  # matter how correct the config is. Testing an IPv4-only rendering keeps the
  # check meaningful everywhere.
  #
  # The obvious hazard is that this workaround would also hide the IPv6
  # listeners being DELETED from the real template, so that is asserted directly
  # against the real file first — the substitution can only ever remove lines the
  # assertion has already proven are there.
  check "template listens on IPv6 for both :80 and :443" \
    "$([[ $(grep -cE '^\s*listen\s+\[::\]:(80|443)' "${DIRECTIVES}") -eq 2 ]]; echo $?)"

  IPV4_ONLY="${WORK}/ipv4-only.conf"
  grep -vE '^\s*listen\s+\[::\]:' "${RENDERED}" > "${IPV4_ONLY}"

  out="$(docker run --rm --network host "${UPSTREAM_HOSTS[@]}" \
    -v "${NGINX_CONF}:/etc/nginx/nginx.conf:ro" \
    -v "${IPV4_ONLY}:/etc/nginx/conf.d/wizer-signage.conf:ro" \
    -v "${WORK}/certs:/etc/letsencrypt/live/${TEST_DOMAIN}:ro" \
    "${NGINX_IMAGE}" nginx -t 2>&1)"
  rc=$?
  check "nginx -t accepts the rendered production config" "${rc}"
  [[ ${rc} -ne 0 ]] && printf '%s\n' "${out}" >&2

  check "nginx -t reports the test as successful, not merely parseable" \
    "$(printf '%s' "${out}" | grep -q 'test is successful'; echo $?)"

  # A config that merely parses is not enough — assert nginx agrees the
  # directives are where we think they are by dumping the effective config.
  dump="$(docker run --rm --network host "${UPSTREAM_HOSTS[@]}" \
    -v "${NGINX_CONF}:/etc/nginx/nginx.conf:ro" \
    -v "${IPV4_ONLY}:/etc/nginx/conf.d/wizer-signage.conf:ro" \
    -v "${WORK}/certs:/etc/letsencrypt/live/${TEST_DOMAIN}:ro" \
    "${NGINX_IMAGE}" nginx -T 2>/dev/null)"
  check "effective config carries the cleared Connection header" \
    "$(printf '%s' "${dump}" | grep -q 'proxy_set_header Connection *""'; echo $?)"
fi

echo
echo "==> ${pass} passed, ${fail} failed"
[[ "${fail}" -eq 0 ]]
