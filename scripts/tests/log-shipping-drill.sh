#!/usr/bin/env bash
# =============================================================================
# Off-box log-shipping drill (Docker required).
# =============================================================================
# OPT-IN / MANUAL: needs a working Docker daemon and pulls fluent/fluentd plus
# alpine. NOT run in CI, which has no collector. Everything it creates is
# namespaced `lsd_*` and removed on exit.
#
# WHY THIS EXISTS:
#   Until this file, every assertion about off-box logging was a string match on
#   YAML -- that the overlay CONTAINS `driver: fluentd`. Not one line had ever
#   been shipped to a collector. `fluentd-async: 'true'` makes that gap
#   dangerous rather than merely untested: a collector that is unreachable,
#   misconfigured or dead costs nothing observable. Containers start, stay
#   healthy, `docker logs` looks completely normal, the Docker daemon logs no
#   complaint -- and zero lines leave the host.
#
# Proves:
#   1. A line emitted by a container actually arrives at a Fluentd collector.
#   2. It arrives under the per-container tag the overlay configures, so blue
#      and green slots stay distinguishable off-box.
#   3. The canary script's marker is exactly what reaches the collector -- the
#      string the operator's dead-man rule matches on. If this drifts, the alert
#      silently stops firing and nothing else would notice.
#   4. An unreachable collector delivers NOTHING while the container stays
#      healthy and `docker logs` stays normal -- the failure the canary exists
#      to make visible.
#
# Usage:  bash scripts/tests/log-shipping-drill.sh
# =============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[ -f "$REPO/scripts/log-shipping-canary.sh" ] || { echo "cannot locate repo root" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "docker not available — skipping drill" >&2; exit 2; }

NET=lsd_net; COL=lsd_collector; WORK="$(mktemp -d)"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  ok   - $1"; }
no(){ FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
cleanup(){ docker rm -f "$COL" lsd_api_blue lsd_canary lsd_dark >/dev/null 2>&1 || true
           docker network rm "$NET" >/dev/null 2>&1 || true
           rm -rf "$WORK" || true; }
trap cleanup EXIT
cleanup

mkdir -p "$WORK/conf" "$WORK/out"; chmod -R 777 "$WORK"
cat > "$WORK/conf/fluent.conf" <<'EOF'
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>
<match **>
  @type file
  path /fluentd/out/received
  append true
  include_tag_key true
  tag_key fluentd_tag
  <buffer>
    @type memory
    flush_mode immediate
  </buffer>
  <format>
    @type json
  </format>
</match>
EOF

docker network create "$NET" >/dev/null
# The DOCKER DAEMON opens the fluentd connection, not the container, so the
# collector has to be reachable from the host -- publishing the port is the
# whole point. An address that only resolves inside $NET would ship nothing,
# which is precisely the mistake this drill exists to catch in production.
docker run -d --name "$COL" --network "$NET" -p 127.0.0.1:24224:24224 \
  -v "$WORK/conf":/fluentd/etc:ro -v "$WORK/out":/fluentd/out \
  -e FLUENTD_CONF=fluent.conf fluent/fluentd:v1.17-1 >/dev/null
for _ in $(seq 1 40); do
  docker logs "$COL" 2>&1 | grep -q 'fluentd worker is now running' && break; sleep 1
done

log_opts=(--log-driver fluentd
  --log-opt fluentd-address=127.0.0.1:24224
  --log-opt fluentd-async=true
  --log-opt fluentd-buffer-limit=8388608
  --log-opt fluentd-retry-wait=1s
  --log-opt "tag=wizer.{{.Name}}")

received(){ cat "$WORK"/out/received.*.log 2>/dev/null; }
wait_for(){ for _ in $(seq 1 30); do received | grep -q "$1" && return 0; sleep 1; done; return 1; }

echo "== A: a container line reaches the collector under its own tag =="
# The container name is what `tag: wizer.{{.Name}}` renders, so this case has to
# use a slot-shaped name -- but NEVER a real one. `wizer-signage-api-blue` is the
# live production blue slot's container_name (docker-compose.blue-green-slots.yml),
# and `docker rm -f` on it would destroy the running API. The lsd_ prefix keeps
# the rendered tag realistic while guaranteeing no collision with a real container.
SLOT_NAME=lsd_api_blue
docker run -d --name "$SLOT_NAME" --network "$NET" "${log_opts[@]}" \
  alpine:3.20 sh -c 'echo "{\"level\":\"error\",\"msg\":\"drill-line-alpha\"}"; sleep 60' >/dev/null
if wait_for drill-line-alpha; then ok "A: emitted line arrived off-box"; else no "A: line never arrived"; fi
TAG="$(received | grep drill-line-alpha | head -1 | sed -nE 's/.*"fluentd_tag":"([^"]+)".*/\1/p')"
[ "$TAG" = "wizer.${SLOT_NAME}" ] \
  && ok "A: arrived under the per-container tag ($TAG)" || no "A: unexpected tag '$TAG'"
docker rm -f "$SLOT_NAME" >/dev/null 2>&1

echo "== B: the canary marker survives the trip intact =="
MARKER="$(bash "$REPO/scripts/log-shipping-canary.sh" | sed -nE 's/.*"marker":"([^"]+)".*/\1/p')"
[ -n "$MARKER" ] && ok "B: canary emits a marker ($MARKER)" || no "B: canary emitted no marker"
# The canary is executed here on the host rather than inside the throwaway
# container: the maintenance image is what runs it in production, and that it is
# present and executable there is already pinned by maintenance-runtime.spec.ts.
# What this case has to prove is the other half -- that the exact line the script
# produces survives the trip and stays matchable by the operator's dead-man rule.
CANARY_LINE="$(bash "$REPO/scripts/log-shipping-canary.sh")"
docker run -d --name lsd_canary --network "$NET" "${log_opts[@]}" \
  -e CANARY_LINE="$CANARY_LINE" \
  alpine:3.20 sh -c 'printf "%s\n" "$CANARY_LINE"; sleep 60' >/dev/null
if wait_for "$MARKER"; then ok "B: canary marker arrived at the collector"; else no "B: canary marker never arrived"; fi
if received | grep -q 'log-shipping-canary'; then
  ok "B: canary line is identifiable by logger name"
else
  no "B: canary line lacks its logger name"
fi
# The arriving payload must still parse as the JSON the collector will index.
if ! command -v python3 >/dev/null 2>&1; then
  echo "  skip - B: JSON validity (python3 not installed)"
elif received | grep "$MARKER" | head -1 | python3 -c '
import sys, json
outer = json.loads(sys.stdin.readline())
json.loads(outer["log"])
'; then
  ok "B: canary payload is still valid JSON at the collector"
else
  no "B: canary payload did not survive as valid JSON"
fi
docker rm -f lsd_canary >/dev/null 2>&1

echo "== C: an unreachable collector ships nothing, silently =="
BEFORE="$(received | wc -l | tr -d ' ')"
docker run -d --name lsd_dark --network "$NET" \
  --log-driver fluentd --log-opt fluentd-address=127.0.0.1:24299 \
  --log-opt fluentd-async=true --log-opt fluentd-buffer-limit=8388608 \
  --log-opt fluentd-retry-wait=1s --log-opt "tag=wizer.{{.Name}}" \
  alpine:3.20 sh -c 'i=0; while [ $i -lt 20 ]; do i=$((i+1)); echo "drill-dark-$i"; sleep 0.2; done; sleep 60' >/dev/null
sleep 10
STATE="$(docker inspect lsd_dark --format '{{.State.Status}}' 2>/dev/null)"
[ "$STATE" = "running" ] && ok "C: container stays running with a dead collector" || no "C: container state '$STATE'"
LOCAL="$(docker logs lsd_dark 2>/dev/null | grep -c 'drill-dark-')"
[ "$LOCAL" -gt 0 ] && ok "C: docker logs still shows $LOCAL lines locally" || no "C: local logs unexpectedly empty"
AFTER="$(received | wc -l | tr -d ' ')"
DARK="$(received | grep -c 'drill-dark-' || true)"
# That nothing arrives at a port nobody is listening on is a tautology; it is
# recorded only as the precondition for the assertions that follow.
[ "$DARK" -eq 0 ] && [ "$BEFORE" = "$AFTER" ] \
  || no "C: precondition lost — the dark container delivered $DARK lines"

# The finding worth proving is that this total loss is INVISIBLE. Each of these
# is a place an operator would reasonably look to notice, and none of them shows
# anything wrong.
HEALTH="$(docker inspect lsd_dark --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')"
[ "$STATE" = "running" ] && ok "C: state stays 'running' — nothing to notice there" || no "C: state was '$STATE'"
[ "$LOCAL" -gt 0 ] && ok "C: docker logs looks completely normal ($LOCAL lines)" || no "C: local logs empty"
EXITED="$(docker inspect lsd_dark --format '{{.State.ExitCode}}')"
[ "$EXITED" = "0" ] && ok "C: no error exit code to alert on" || no "C: unexpected exit code $EXITED"
case "$HEALTH" in
  unhealthy) no "C: health status flagged the loss (unexpected — would be good news)" ;;
  *) ok "C: health status ($HEALTH) does not reflect the loss" ;;
esac
echo "  note - C: total off-box loss, and none of state/logs/exit-code/health shows it"
echo "         this is precisely what the log-shipping canary exists to surface"

echo
echo "== log-shipping drill: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
