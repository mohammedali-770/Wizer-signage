#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — scripts/smoke-test.sh self-test
# =============================================================================
# A smoke test that cannot fail is worse than none: it turns "we verified the
# deploy" into a sentence nobody checked. Every case here breaks ONE thing in a
# stub server and asserts the smoke test notices — and that it stays green when
# nothing is broken.
#
# No real deployment is involved. A stub HTTP server on localhost stands in for
# nginx + the API, and each mode below makes it misbehave in one specific way.
#
# Usage:  bash scripts/tests/smoke-test.test.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SMOKE="${ROOT_DIR}/scripts/smoke-test.sh"

WORK="$(mktemp -d)"
SERVER_PID=""
cleanup() { [[ -n "${SERVER_PID}" ]] && kill "${SERVER_PID}" 2>/dev/null; rm -rf "${WORK}"; }
trap cleanup EXIT

pass=0; fail=0
ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         $2"; fail=$(( fail + 1 )); }

command -v python3 >/dev/null 2>&1 || { echo "python3 is required for this harness" >&2; exit 1; }

# --- Stub server -------------------------------------------------------------
# MODE (env) selects exactly one deviation from a healthy deployment.
cat > "${WORK}/server.py" <<'PY'
import json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

MODE = os.environ.get("MODE", "healthy")
SAFE = lambda s: s and all(c.isalnum() or c in "._-" for c in s) and len(s) <= 128

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # keep the harness output clean
        pass

    def _send(self, code, body, ctype="application/json", request_id=True, extra=None):
        raw = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        if request_id and MODE != "no-request-id":
            inbound = self.headers.get("X-Request-Id")
            # A healthy app honours a well-formed inbound id and replaces junk.
            if MODE == "id-not-honoured":
                rid = "server-minted-id"
            elif inbound and SAFE(inbound):
                rid = inbound
            else:
                rid = "generated-0123456789"
            self.send_header("X-Request-Id", rid)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        p = self.path
        if p == "/api/health":
            return self._send(200, json.dumps({"status": "ok", "service": "wizer-signage-api"}))
        if p == "/api/health/ready":
            if MODE == "db-down":
                return self._send(503, json.dumps({"status": "error", "checks": {"database": "down"}}))
            return self._send(200, json.dumps({"status": "ok", "checks": {"database": "up"}}))
        if p == "/":
            return self._send(200, "<!DOCTYPE html><html><body>dashboard</body></html>", "text/html")
        # Anything else is a 404 in the platform's envelope.
        if MODE == "bad-envelope":
            return self._send(404, "Not Found", "text/plain")
        return self._send(404, json.dumps({
            "success": False,
            "error": {"code": "NOT_FOUND", "message": f"Cannot GET {p}",
                      "details": {"requestId": "generated-0123456789"}},
        }))

    def do_POST(self):
        p = self.path
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        if p == "/api/auth/login":
            if MODE == "validation-accepts":
                return self._send(200, json.dumps({"success": True}))
            return self._send(400, json.dumps({
                "success": False,
                "error": {"code": "BAD_REQUEST", "message": "email must be an email"},
            }))
        if p.startswith("/api/downloads/android/"):
            if MODE == "downloads-writable":
                return self._send(201, json.dumps({"success": True}))
            return self._send(403, json.dumps({"error": "forbidden"}))
        return self._send(404, json.dumps({"success": False, "error": {"code": "NOT_FOUND"}}))

srv = HTTPServer(("127.0.0.1", 0), H)
print(srv.server_port, flush=True)
srv.serve_forever()
PY

start_server() {
  local mode="$1"
  [[ -n "${SERVER_PID}" ]] && { kill "${SERVER_PID}" 2>/dev/null; wait "${SERVER_PID}" 2>/dev/null; }
  MODE="${mode}" python3 "${WORK}/server.py" > "${WORK}/port" 2>"${WORK}/server.err" &
  SERVER_PID=$!
  for _ in $(seq 1 50); do
    PORT="$(head -1 "${WORK}/port" 2>/dev/null)"
    [[ -n "${PORT}" ]] && break
    sleep 0.1
  done
  [[ -n "${PORT:-}" ]] || { echo "stub server failed to start: $(cat "${WORK}/server.err")" >&2; exit 1; }
  BASE="http://127.0.0.1:${PORT}"
}

# Runs the smoke test against the stub and reports its exit code in RC / OUT.
run_smoke() {
  OUT="$(bash "${SMOKE}" "${BASE}" 2>&1)"
  RC=$?
}

echo "=== smoke-test.sh self-test ==="

# --- 1. A healthy deployment passes -----------------------------------------
start_server healthy
run_smoke
if (( RC == 0 )) && [[ "${OUT}" == *"Smoke test passed."* ]]; then
  ok "passes against a healthy deployment"
else
  no "passes against a healthy deployment" "rc=${RC}
${OUT}"
fi

# --- 2. Readiness is the gate, not liveness ---------------------------------
# The key case: /api/health still says ok, only /ready fails. A smoke test that
# checked liveness alone would call this deploy good.
start_server db-down
run_smoke
if (( RC != 0 )) && [[ "${OUT}" == *"cannot reach its database"* ]]; then
  ok "fails when the API is up but the database is unreachable"
else
  no "fails when the API is up but the database is unreachable" "rc=${RC}
${OUT}"
fi

# --- 3. Missing correlation header ------------------------------------------
start_server no-request-id
run_smoke
if (( RC != 0 )) && [[ "${OUT}" == *"X-Request-Id is set"* ]] && [[ "${OUT}" == *"FAIL"* ]]; then
  ok "fails when X-Request-Id is absent"
else
  no "fails when X-Request-Id is absent" "rc=${RC}
${OUT}"
fi

# --- 4. Inbound ID discarded -------------------------------------------------
# Subtle and worth catching: the header is present, so a shallow check passes,
# but nginx's ID never reaches the app and the two logs cannot be joined.
start_server id-not-honoured
run_smoke
if (( RC != 0 )) && [[ "${OUT}" == *"preserved end to end"* ]]; then
  ok "fails when a valid inbound X-Request-Id is discarded"
else
  no "fails when a valid inbound X-Request-Id is discarded" "rc=${RC}
${OUT}"
fi

# --- 5. Error envelope regressed --------------------------------------------
start_server bad-envelope
run_smoke
if (( RC != 0 )) && [[ "${OUT}" == *"error envelope"* ]]; then
  ok "fails when 404s do not use the standard error envelope"
else
  no "fails when 404s do not use the standard error envelope" "rc=${RC}
${OUT}"
fi

# --- 6. ValidationPipe not wired --------------------------------------------
start_server validation-accepts
run_smoke
if (( RC != 0 )) && [[ "${OUT}" == *"ValidationPipe"* ]]; then
  ok "fails when a malformed body is accepted instead of rejected"
else
  no "fails when a malformed body is accepted instead of rejected" "rc=${RC}
${OUT}"
fi

# --- 7. Download path accepts writes ----------------------------------------
start_server downloads-writable
run_smoke
if (( RC != 0 )) && [[ "${OUT}" == *"refuses write methods"* ]]; then
  ok "fails when the APK download path accepts a write method"
else
  no "fails when the APK download path accepts a write method" "rc=${RC}
${OUT}"
fi

# --- 8. TLS checks skip cleanly over plain HTTP ------------------------------
start_server healthy
run_smoke
if (( RC == 0 )) && [[ "${OUT}" == *"SKIP"* ]] && [[ "${OUT}" == *"not https"* ]]; then
  ok "skips TLS-only checks over plain HTTP instead of failing them"
else
  no "skips TLS-only checks over plain HTTP instead of failing them" "rc=${RC}
${OUT}"
fi

# --- 9. Rate limiting is opt-in ---------------------------------------------
if [[ "${OUT}" == *"pass --rate-limit"* ]]; then
  ok "leaves the disruptive rate-limit check out unless asked"
else
  no "leaves the disruptive rate-limit check out unless asked" "${OUT}"
fi

# --- 10. Refuses to run without a target ------------------------------------
out="$(SMOKE_BASE_URL= bash "${SMOKE}" 2>&1)"; rc=$?
if (( rc != 0 )) && [[ "${out}" == *"no base URL"* ]]; then
  ok "refuses to run without a base URL"
else
  no "refuses to run without a base URL" "rc=${rc} ${out}"
fi

# --- 11. An unreachable host fails rather than hanging or passing ------------
OUT="$(bash "${SMOKE}" "http://127.0.0.1:1" 2>&1)"; RC=$?
if (( RC != 0 )); then
  ok "fails against an unreachable host"
else
  no "fails against an unreachable host" "rc=${RC}
${OUT}"
fi

echo
echo "=== ${pass} passed, ${fail} failed ==="
(( fail == 0 ))
