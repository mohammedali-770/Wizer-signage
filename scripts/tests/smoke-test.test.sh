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
import json, os, socket, ssl, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

MODE = os.environ.get("MODE", "healthy")
# When set, one port answers both schemes (see Server.get_request below) so the
# smoke test's is_https branch can be driven.
TLS_CERT = os.environ.get("TLS_CERT") or ""
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
            elif MODE == "edge":
                # nginx sets `X-Request-Id $request_id`: a fresh id every
                # request, whatever the client sent. Plain `healthy` under TLS
                # is the opposite -- it honours the inbound id, which is what a
                # `$http_x_request_id` misconfiguration looks like from outside.
                rid = "edge-minted-0123456789"
            elif inbound and SAFE(inbound):
                rid = inbound
            else:
                rid = "generated-0123456789"
            self.send_header("X-Request-Id", rid)
        if self.over_tls():
            # What the shipped nginx templates add and the smoke test checks for.
            self.send_header("Strict-Transport-Security", "max-age=31536000")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def over_tls(self):
        return isinstance(self.connection, ssl.SSLSocket)

    def redirect_to_https(self):
        # A TLS deployment must never SERVE over :80, only redirect. Without
        # this the smoke test's downgrade check has nothing to observe.
        self.send_response(301)
        self.send_header("Location", f"https://{self.headers.get('Host')}{self.path}")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if TLS_CERT and not self.over_tls():
            return self.redirect_to_https()
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
        if TLS_CERT and not self.over_tls():
            return self.redirect_to_https()
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

class Server(HTTPServer):
    """Serves HTTPS and HTTP on ONE port.

    smoke-test.sh derives its downgrade check's URL from the base URL by
    swapping the scheme and keeping host:port, so both have to land here.
    A TLS ClientHello starts with 0x16; peek at the first byte without
    consuming it and wrap only those connections.
    """

    def get_request(self):
        sock, addr = self.socket.accept()
        if TLS_CERT and sock.recv(1, socket.MSG_PEEK) == b"\x16":
            sock = CTX.wrap_socket(sock, server_side=True)
        return sock, addr


if TLS_CERT:
    CTX = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    CTX.load_cert_chain(TLS_CERT)

srv = Server(("127.0.0.1", 0), H)
print(srv.server_port, flush=True)
srv.serve_forever()
PY

# A self-signed cert for 127.0.0.1. Without it the is_https branch of the smoke
# test is unreachable from this harness, which is exactly how a hole in it went
# unnoticed: every case below ran over plain HTTP, where that branch is skipped.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "${WORK}/tls.key" -out "${WORK}/tls.crt" \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  >/dev/null 2>&1 || { echo "openssl is required to generate the test certificate" >&2; exit 1; }
cat "${WORK}/tls.crt" "${WORK}/tls.key" > "${WORK}/tls.pem"

# start_server <mode> [tls]  -- pass "tls" to put the stub behind HTTPS.
start_server() {
  local mode="$1" scheme="${2:-}" cert=""
  [[ "${scheme}" == "tls" ]] && cert="${WORK}/tls.pem"
  [[ -n "${SERVER_PID}" ]] && { kill "${SERVER_PID}" 2>/dev/null; wait "${SERVER_PID}" 2>/dev/null; }
  rm -f "${WORK}/port"
  MODE="${mode}" TLS_CERT="${cert}" python3 "${WORK}/server.py" > "${WORK}/port" 2>"${WORK}/server.err" &
  SERVER_PID=$!
  for _ in $(seq 1 50); do
    PORT="$(head -1 "${WORK}/port" 2>/dev/null)"
    [[ -n "${PORT}" ]] && break
    sleep 0.1
  done
  [[ -n "${PORT:-}" ]] || { echo "stub server failed to start: $(cat "${WORK}/server.err")" >&2; exit 1; }
  if [[ -n "${cert}" ]]; then BASE="https://127.0.0.1:${PORT}"; else BASE="http://127.0.0.1:${PORT}"; fi
}

# Runs the smoke test against the stub and reports its exit code in RC / OUT.
# CURL_CA_BUNDLE trusts the throwaway cert; no_proxy keeps a proxy-configured
# environment from intercepting a loopback request.
run_smoke() {
  OUT="$(CURL_CA_BUNDLE="${WORK}/tls.crt" no_proxy="127.0.0.1,localhost" NO_PROXY="127.0.0.1,localhost" \
    bash "${SMOKE}" "${BASE}" 2>&1)"
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

# --- 12. Behind TLS, an edge that originates the ID passes -------------------
# The whole is_https branch had no coverage before this: cases 1-11 run over
# plain HTTP, where it is skipped. The stub now answers both schemes on one
# port, so the edge checks -- security headers, the :80 redirect, and the ID
# below -- are exercised for real.
start_server edge tls
run_smoke
if (( RC == 0 )) && [[ "${OUT}" == *"the edge originates a well-formed X-Request-Id"* ]]; then
  ok "passes behind TLS when the edge originates the request ID"
else
  no "passes behind TLS when the edge originates the request ID" "rc=${RC}
${OUT}"
fi

# --- 13. Behind TLS, an edge that FORWARDS the client's ID fails -------------
# The finding this covers: the client's ID is itself well formed, so a check
# that only tested the SHAPE of the returned ID passed while the access log and
# the app log keyed on a value the caller chose -- which is the one thing the
# ID exists to prevent. `healthy` under TLS honours the inbound ID, which is
# what `$http_x_request_id` in place of `$request_id` looks like from outside.
start_server healthy tls
run_smoke
if (( RC != 0 )) && [[ "${OUT}" == *"echoed the client's id"* ]]; then
  ok "fails behind TLS when the edge forwards the client's request ID"
else
  no "fails behind TLS when the edge forwards the client's request ID" "rc=${RC}
${OUT}"
fi

echo
echo "=== ${pass} passed, ${fail} failed ==="
(( fail == 0 ))
