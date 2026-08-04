#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — post-deploy smoke test
# =============================================================================
# Answers one question about a RUNNING deployment: is it actually serving?
#
# CI proves the code builds, typechecks and passes its unit tests. None of that
# exercises the deployed stack — nginx's routing and headers, the API's database
# connection, the correlation-ID chain from edge to app, or the global
# ValidationPipe. Those only exist once the thing is up, which is exactly where
# a "green CI, broken deploy" lands.
#
# READ-ONLY AND NON-DESTRUCTIVE by default. Every request is a GET, a HEAD, or a
# POST that is rejected by validation before it reaches any business logic. It
# creates no data, authenticates as nobody, and needs no credentials — so it is
# safe to point at production. The two checks that could disturb a live system
# are opt-in and named as such (see --rate-limit below).
#
# USAGE:
#   scripts/smoke-test.sh https://signage.example.com
#   scripts/smoke-test.sh                      # uses $SMOKE_BASE_URL
#   scripts/smoke-test.sh <url> --verbose      # show response bodies
#   scripts/smoke-test.sh <url> --rate-limit   # ALSO test the edge limiter
#
# --rate-limit floods the credential endpoint on purpose. It will trip nginx's
# auth zone for THIS CLIENT IP for roughly a minute, so real logins from the
# same address are refused while it recovers. Fine from a runner; think twice
# from an office NAT.
#
# Exit codes: 0 = every check passed, 1 = at least one failed or the base URL
# was unusable. Intended to gate a deploy: run it, and roll back on non-zero.
# =============================================================================
set -uo pipefail

BASE_URL="${SMOKE_BASE_URL:-}"
VERBOSE=0
RATE_LIMIT=0
TIMEOUT="${SMOKE_TIMEOUT:-10}"

for arg in "$@"; do
  case "${arg}" in
    --verbose)    VERBOSE=1 ;;
    --rate-limit) RATE_LIMIT=1 ;;
    --help|-h)    sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)           echo "ERROR: unknown option ${arg}" >&2; exit 1 ;;
    *)            BASE_URL="${arg}" ;;
  esac
done

if [[ -z "${BASE_URL}" ]]; then
  echo "ERROR: no base URL. Pass one, or set SMOKE_BASE_URL." >&2
  echo "       scripts/smoke-test.sh https://signage.example.com" >&2
  exit 1
fi
BASE_URL="${BASE_URL%/}"   # tolerate a trailing slash

command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required." >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

pass=0; fail=0; skip=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$(( pass + 1 )); }
no()   { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [[ -n "${2:-}" ]] && printf '        %s\n' "$2"; fail=$(( fail + 1 )); }
na()   { printf '  \033[33mSKIP\033[0m  %s\n' "$1"; [[ -n "${2:-}" ]] && printf '        %s\n' "$2"; skip=$(( skip + 1 )); }
group(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

# --- Request helper ----------------------------------------------------------
# Populates STATUS / BODY / HEADERS for the caller. Never aborts the run: a
# connection failure is reported as status 000 so the check that wanted it can
# fail with a useful message instead of killing the script.
STATUS=""; BODY=""; HEADERS=""
req() {
  local method="$1" path="$2"; shift 2
  local body_file="${WORK}/body" head_file="${WORK}/head"
  STATUS="$(curl -sS -o "${body_file}" -D "${head_file}" -w '%{http_code}' \
    --max-time "${TIMEOUT}" -X "${method}" "$@" "${BASE_URL}${path}" 2>"${WORK}/err" || echo "000")"
  BODY="$(cat "${body_file}" 2>/dev/null || true)"
  HEADERS="$(cat "${head_file}" 2>/dev/null || true)"
  if (( VERBOSE )); then
    printf '        → %s %s [%s]\n' "${method}" "${path}" "${STATUS}"
    [[ -n "${BODY}" ]] && printf '          %s\n' "$(echo "${BODY}" | head -c 300)"
  fi
}

# JSON body match that ignores insignificant whitespace. Asserting on the exact
# byte layout of a response is brittle: `JSON.stringify` emits no spaces today,
# but a proxy, a pretty-printer or a future serializer change would break every
# check here without anything actually being wrong.
body_has() { [[ "$(echo "${BODY}" | tr -d ' \n\t\r')" == *"$1"* ]]; }

# Case-insensitive header read; returns the value with surrounding space trimmed.
header() {
  echo "${HEADERS}" | tr -d '\r' | grep -i "^$1:" | head -1 | cut -d: -f2- | sed 's/^ *//; s/ *$//'
}

is_https() { [[ "${BASE_URL}" == https://* ]]; }

echo "=== Wizer Signage smoke test — ${BASE_URL} ==="

# --- 1. Liveness -------------------------------------------------------------
group "API"

req GET /api/health
if [[ "${STATUS}" == "200" ]] && body_has '"status":"ok"'; then
  ok "/api/health is live"
else
  no "/api/health is live" "status=${STATUS} body=$(echo "${BODY}" | head -c 120)"
fi

# --- 2. Readiness — the check that actually matters --------------------------
# /api/health answers from process.uptime() and never touches the database, so
# it reports "ok" from a container whose DB connection is dead. /ready runs
# SELECT 1 and 503s when it cannot. This is the deploy gate.
req GET /api/health/ready
if [[ "${STATUS}" == "200" ]] && body_has '"database":"up"'; then
  ok "/api/health/ready reports the database up"
elif [[ "${STATUS}" == "503" ]]; then
  no "/api/health/ready reports the database up" "503 — the API is running but cannot reach its database"
else
  no "/api/health/ready reports the database up" "status=${STATUS} body=$(echo "${BODY}" | head -c 120)"
fi

# --- 3. Correlation ID on a normal response ----------------------------------
req GET /api/health
rid="$(header 'X-Request-Id')"
if [[ -n "${rid}" ]]; then
  ok "X-Request-Id is set on responses"
else
  no "X-Request-Id is set on responses" "header absent — nginx/app correlation is broken"
fi

# --- 4. A well-formed inbound ID is honoured ---------------------------------
# nginx originates this per request; the API must adopt it rather than mint its
# own, otherwise the access log and the app log key on different IDs.
sent="smoke-$(date +%s)-abc"
req GET /api/health -H "X-Request-Id: ${sent}"
if [[ "$(header 'X-Request-Id')" == "${sent}" ]]; then
  ok "a valid inbound X-Request-Id is preserved end to end"
else
  no "a valid inbound X-Request-Id is preserved end to end" "sent=${sent} got=$(header 'X-Request-Id')"
fi

# --- 5. A malformed inbound ID is replaced, never rejected -------------------
# A hostile or broken client must not be able to turn a valid request into an
# error by sending junk in a header the app only uses for logging.
req GET /api/health -H "X-Request-Id: bad id with spaces"
got="$(header 'X-Request-Id')"
if [[ "${STATUS}" == "200" ]] && [[ -n "${got}" ]] && [[ "${got}" != *" "* ]]; then
  ok "a malformed X-Request-Id is replaced, not rejected"
else
  no "a malformed X-Request-Id is replaced, not rejected" "status=${STATUS} got=${got}"
fi

# --- 6. Error envelope -------------------------------------------------------
req GET /api/this-route-does-not-exist
if [[ "${STATUS}" == "404" ]] \
   && body_has '"success":false' \
   && body_has '"code":"NOT_FOUND"' \
   && body_has '"requestId"'; then
  ok "unknown routes return the standard error envelope with a requestId"
else
  no "unknown routes return the standard error envelope with a requestId" \
     "status=${STATUS} body=$(echo "${BODY}" | head -c 160)"
fi

# --- 7. Global ValidationPipe ------------------------------------------------
# Deliberately malformed so class-validator rejects it at the pipe, BEFORE any
# authentication logic runs. The address is not a syntactically valid email, so
# it cannot match a real account and no failed-login attempt is recorded — this
# check cannot contribute to anyone's lockout.
req POST /api/auth/login \
  -H 'Content-Type: application/json' \
  --data '{"email":"not-an-email","password":"x","unexpectedField":true}'
if [[ "${STATUS}" == "400" ]] && body_has '"success":false'; then
  ok "the global ValidationPipe rejects a malformed body (400)"
else
  no "the global ValidationPipe rejects a malformed body (400)" \
     "status=${STATUS} body=$(echo "${BODY}" | head -c 160)"
fi

# --- 8. Edge: TLS and security headers --------------------------------------
group "Edge (nginx)"

if is_https; then
  req GET /api/health
  missing=()
  [[ -n "$(header 'Strict-Transport-Security')" ]] || missing+=("Strict-Transport-Security")
  [[ "$(header 'X-Content-Type-Options')" == "nosniff" ]] || missing+=("X-Content-Type-Options: nosniff")
  [[ -n "$(header 'X-Frame-Options')" ]] || missing+=("X-Frame-Options")
  [[ -n "$(header 'Referrer-Policy')" ]] || missing+=("Referrer-Policy")
  if (( ${#missing[@]} == 0 )); then
    ok "security headers are present"
  else
    no "security headers are present" "missing: ${missing[*]}"
  fi

  # HTTP must redirect, not serve. A deploy that leaves :80 answering directly
  # silently downgrades every client that omits the scheme.
  http_url="http://${BASE_URL#https://}"
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "${TIMEOUT}" "${http_url}/api/health" 2>/dev/null || echo "000")"
  if [[ "${code}" == "301" || "${code}" == "302" || "${code}" == "308" ]]; then
    ok "plain HTTP redirects to HTTPS (${code})"
  else
    no "plain HTTP redirects to HTTPS" "got ${code} — expected a redirect"
  fi
else
  na "security headers are present" "base URL is not https — nginx/TLS not in front"
  na "plain HTTP redirects to HTTPS" "base URL is not https"
fi

# --- 9. Static APK distribution ---------------------------------------------
# Served directly by nginx from a read-only mount, not proxied to the API.
# `limit_except GET HEAD` must reject writes even though nothing is published.
req POST /api/downloads/android/latest.json
if [[ "${STATUS}" == "403" || "${STATUS}" == "405" ]]; then
  ok "the APK download path refuses write methods (${STATUS})"
elif [[ "${STATUS}" == "404" ]]; then
  na "the APK download path refuses write methods" "404 — no release published yet, or the route is not mounted"
else
  no "the APK download path refuses write methods" "status=${STATUS} — a write method should never be accepted here"
fi

# --- 10. Dashboard -----------------------------------------------------------
group "Dashboard"

req GET /
if [[ "${STATUS}" == "200" ]] && [[ "${BODY}" == *"<html"* || "${BODY}" == *"<!DOCTYPE"* ]]; then
  ok "the dashboard serves HTML at /"
elif [[ "${STATUS}" == "307" || "${STATUS}" == "302" ]]; then
  ok "the dashboard redirects / to a locale (${STATUS})"
elif [[ "${STATUS}" == "404" ]]; then
  # Most likely cause is a misaimed run rather than a broken dashboard: point
  # this at the PUBLIC url that nginx serves, not at the API container's port.
  no "the dashboard serves HTML at /" \
     "404 — is this the public URL? nginx serves the dashboard at /, the API only under /api/"
else
  no "the dashboard serves HTML at /" "status=${STATUS}"
fi

# --- 11. Rate limiting (opt-in) ---------------------------------------------
if (( RATE_LIMIT )); then
  group "Edge rate limiting (disruptive)"
  # nginx's auth zone is 20r/m with burst=10; 40 rapid requests must produce
  # some 429s. Bodies are deliberately invalid for the same reason as check 7.
  got429=0
  for _ in $(seq 1 40); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "${TIMEOUT}" \
      -X POST -H 'Content-Type: application/json' \
      --data '{"email":"not-an-email","password":"x"}' \
      "${BASE_URL}/api/auth/login" 2>/dev/null || echo "000")"
    [[ "${code}" == "429" ]] && got429=$(( got429 + 1 ))
  done
  if (( got429 > 0 )); then
    ok "the credential endpoint sheds load at the edge (${got429}/40 got 429)"
  else
    no "the credential endpoint sheds load at the edge" \
       "no 429 in 40 rapid requests — the nginx auth zone is not limiting"
  fi
else
  group "Edge rate limiting"
  na "credential endpoint rate limiting" "not run — pass --rate-limit to include it (trips the limiter for this IP)"
fi

# --- Summary -----------------------------------------------------------------
printf '\n=== %d passed, %d failed, %d skipped ===\n' "${pass}" "${fail}" "${skip}"
if (( fail > 0 )); then
  echo "SMOKE TEST FAILED — do not consider this deploy good." >&2
  exit 1
fi
echo "Smoke test passed."
