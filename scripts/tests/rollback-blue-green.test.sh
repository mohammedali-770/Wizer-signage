#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — scripts/rollback-blue-green.sh target-selection tests
# =============================================================================
# The blue/green rollback picks its target by walking the deployment history
# newest-first, skipping the release currently serving and every release already
# rolled away from. That walk is the whole value of the script during an outage,
# and it is the part with no way to check itself: a wrong choice does not error,
# it quietly serves the wrong release.
#
# The rule under test that is easiest to get wrong is when a "rolled away from"
# mark STOPS applying. A permanent mark is unfalsifiable — a release could never
# be reached again however many times it was successfully shipped afterwards,
# and repeated rollbacks would drain toward the unverified `legacy` branch.
# Deploying the same tag again supersedes the mark; deploying a DIFFERENT one
# says nothing about it and must not.
#
# No stack is started. `docker` and `curl` are stubbed on PATH, so every case
# runs the real selection logic and stops at a recorded, inert call.
#
# Usage:  bash scripts/tests/rollback-blue-green.test.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ROLLBACK="${ROOT_DIR}/scripts/rollback-blue-green.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

pass=0
fail=0
ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         $2"; fail=$(( fail + 1 )); }

# --- Stubs -------------------------------------------------------------------
# `docker` answers the three questions the script asks of a live host — which
# upstreams nginx is serving, which image a container runs, and which release an
# image is — and performs nothing. Every call is recorded so a test can assert
# that nginx was never written.
mkdir -p "${WORK}/bin"
cat > "${WORK}/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "${STUB_LOG}"
case "$1" in
  exec)
    shift
    [[ "$1" == "-i" ]] && shift
    shift # container
    case "$*" in
      "cat /etc/nginx/runtime/active-upstreams.conf") cat "${STUB_STATE}/upstreams" ;;
      *"cat > "*) cat > "${STUB_STATE}/proposed" ;;
    esac
    ;;
  inspect)
    if [[ "$*" == *"State.Health"* ]]; then
      echo healthy
    else
      for arg in "$@"; do
        case "${arg}" in
          wizer-signage-api-blue)  echo "wizer-signage/api:blue";   exit 0 ;;
          wizer-signage-api-green) echo "wizer-signage/api:green";  exit 0 ;;
          wizer-signage-api)       echo "wizer-signage/api:legacy"; exit 0 ;;
        esac
      done
      exit 1
    fi
    ;;
  image)
    shift 2
    img=""
    while (( $# )); do
      case "$1" in
        --format) shift 2 ;;
        *) img="$1"; shift ;;
      esac
    done
    line="$(grep -E "^${img} " "${STUB_STATE}/labels" 2>/dev/null)" || exit 1
    awk '{print $2}' <<<"${line}"
    ;;
esac
exit 0
STUB
chmod +x "${WORK}/bin/docker"

# The public readiness gate must not reach the network from a unit test.
cat > "${WORK}/bin/curl" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "${WORK}/bin/curl"
export PATH="${WORK}/bin:${PATH}"

mkdir -p "${WORK}/state"
cat > "${WORK}/.env" <<'ENVFILE'
APP_DOMAIN=signage.example.com
LOG_SHIPPING_ADDRESS=udp://logs.example.com:5514
ENVFILE

# --- Case driver -------------------------------------------------------------
# Seeds a live proxy pointing at <live_slot>, an image carrying <live_sha>, and
# the release images the expected target needs, then runs the real script.
# A wrong selection fails twice over: the asserted switch line will not match,
# and the target slot image will not carry the sha the script demands.
seed() {
  local live_slot="$1" live_sha="$2" target_slot="$3" target_sha="$4"
  cat > "${WORK}/state/upstreams" <<EOF
upstream api_upstream {
    server api-${live_slot}:3001;
}
upstream dashboard_upstream {
    server dashboard-${live_slot}:3000;
}
EOF
  {
    echo "wizer-signage/api:${live_slot} ${live_sha}"
    echo "wizer-signage/api:${target_slot} ${target_sha}"
    echo "wizer-signage/dashboard:${target_slot} ${target_sha}"
  } > "${WORK}/state/labels"
}

run_rollback() {
  : > "${WORK}/stub.log"
  env PATH="${PATH}" \
    STUB_LOG="${WORK}/stub.log" STUB_STATE="${WORK}/state" \
    ENV_FILE="${WORK}/.env" \
    BLUE_GREEN_HISTORY="${WORK}/bg-history" \
    BLUE_GREEN_ROLLBACK_HISTORY="${WORK}/rollbacks" \
    DEPLOY_STATE="${WORK}/legacy-history" \
    SKIP_SMOKE=1 API_DRAIN_SECONDS=0 HEALTH_INTERVAL=0 HEALTH_RETRIES=2 \
    bash "${ROLLBACK}" 2>&1
}

# Asserts the script announced a switch to the expected slot/tag.
expect_target() {
  local label="$1" want="$2" out rc
  out="$(run_rollback)"; rc=$?
  if (( rc == 0 )) && [[ "${out}" == *"to ${want}."* ]]; then
    ok "${label}"
  else
    no "${label}" "rc=${rc} want='to ${want}' out=${out}"
  fi
}

SHA_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SHA_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
SHA_C=cccccccccccccccccccccccccccccccccccccccc
SHA_D=dddddddddddddddddddddddddddddddddddddddd
TAG_A=aaaaaaaaaaaa
TAG_B=bbbbbbbbbbbb
TAG_C=cccccccccccc
TAG_D=dddddddddddd

echo "=== rollback-blue-green.sh target selection ==="

# --- 1. The ordinary case ----------------------------------------------------
cat > "${WORK}/bg-history" <<EOF
2026-08-03T09:00:00Z blue ${TAG_A} ${SHA_A}
2026-08-03T10:00:00Z green ${TAG_B} ${SHA_B}
EOF
: > "${WORK}/rollbacks"
seed green "${SHA_B}" blue "${SHA_A}"
expect_target "selects the previous release, not the one currently serving" "blue/${TAG_A}"

# --- 2. A second rollback does not bounce back into the known-bad release ----
cat > "${WORK}/bg-history" <<EOF
2026-08-03T08:00:00Z green ${TAG_C} ${SHA_C}
2026-08-03T09:00:00Z blue ${TAG_A} ${SHA_A}
2026-08-03T10:00:00Z green ${TAG_B} ${SHA_B}
EOF
cat > "${WORK}/rollbacks" <<EOF
2026-08-03T10:30:00Z ROLLBACK from=green/${TAG_B} to=blue/${TAG_A} targetSha=${SHA_A}
EOF
seed blue "${SHA_A}" green "${SHA_C}"
expect_target "steps past a release already rolled away from" "green/${TAG_C}"

# --- 3. THE FIX: redeploying a rolled-away release clears the mark -----------
# B was escaped at 10:30, then deployed again at 11:00 — which in blue/green
# means it passed the public readiness and smoke gates a second time. It is a
# legitimate target again. Without this, the walk skips B and lands on A.
cat > "${WORK}/bg-history" <<EOF
2026-08-03T09:00:00Z blue ${TAG_A} ${SHA_A}
2026-08-03T10:00:00Z green ${TAG_B} ${SHA_B}
2026-08-03T11:00:00Z green ${TAG_B} ${SHA_B}
2026-08-03T12:00:00Z blue ${TAG_D} ${SHA_D}
EOF
cat > "${WORK}/rollbacks" <<EOF
2026-08-03T10:30:00Z ROLLBACK from=green/${TAG_B} to=blue/${TAG_A} targetSha=${SHA_A}
EOF
seed blue "${SHA_D}" green "${SHA_B}"
expect_target "a rolled-away release is selectable again once redeployed" "green/${TAG_B}"

# --- 4. ...but only that exact release ---------------------------------------
# C is newer than B's rollback mark, yet says nothing about B. Both B and C have
# been rolled away from, so the walk must reach all the way back to A.
cat > "${WORK}/bg-history" <<EOF
2026-08-03T09:00:00Z green ${TAG_A} ${SHA_A}
2026-08-03T10:00:00Z blue ${TAG_B} ${SHA_B}
2026-08-03T11:00:00Z green ${TAG_C} ${SHA_C}
2026-08-03T12:00:00Z blue ${TAG_D} ${SHA_D}
EOF
cat > "${WORK}/rollbacks" <<EOF
2026-08-03T10:30:00Z ROLLBACK from=blue/${TAG_B} to=green/${TAG_A} targetSha=${SHA_A}
2026-08-03T11:30:00Z ROLLBACK from=green/${TAG_C} to=blue/${TAG_B} targetSha=${SHA_B}
EOF
seed blue "${SHA_D}" green "${SHA_A}"
expect_target "a newer DIFFERENT release does not clear an older mark" "green/${TAG_A}"

# --- 5. A tie is not evidence ------------------------------------------------
# Same-second deploy and rollback cannot be ordered from the logs, so the
# conservative reading wins and B stays excluded.
cat > "${WORK}/bg-history" <<EOF
2026-08-03T09:00:00Z green ${TAG_A} ${SHA_A}
2026-08-03T10:00:00Z blue ${TAG_B} ${SHA_B}
2026-08-03T11:00:00Z blue ${TAG_B} ${SHA_B}
2026-08-03T12:00:00Z blue ${TAG_D} ${SHA_D}
EOF
cat > "${WORK}/rollbacks" <<EOF
2026-08-03T11:00:00Z ROLLBACK from=blue/${TAG_B} to=green/${TAG_A} targetSha=${SHA_A}
EOF
seed blue "${SHA_D}" green "${SHA_A}"
expect_target "an equal-timestamp redeploy does not clear the mark" "green/${TAG_A}"

# --- 6. Everything excluded falls back to legacy -----------------------------
cat > "${WORK}/bg-history" <<EOF
2026-08-03T09:00:00Z blue ${TAG_A} ${SHA_A}
2026-08-03T10:00:00Z green ${TAG_B} ${SHA_B}
EOF
cat > "${WORK}/rollbacks" <<EOF
2026-08-03T10:30:00Z ROLLBACK from=green/${TAG_B} to=blue/${TAG_A} targetSha=${SHA_A}
2026-08-03T11:30:00Z ROLLBACK from=blue/${TAG_A} to=legacy/legacy targetSha=unknown
EOF
: > "${WORK}/legacy-history"
seed green "${SHA_B}" blue "${SHA_A}"
expect_target "falls back to legacy once every release is excluded" "legacy/legacy"

# --- 6b. The first rollback ever, with no rollback log on the host -----------
# ROLLBACK_HISTORY has no existence guard, so the very first rollback reads a
# file that is not there. Under `set -e` a bare failing command substitution
# would abort the run before any release is chosen.
cat > "${WORK}/bg-history" <<EOF
2026-08-03T09:00:00Z blue ${TAG_A} ${SHA_A}
2026-08-03T10:00:00Z green ${TAG_B} ${SHA_B}
EOF
rm -f "${WORK}/rollbacks"
seed green "${SHA_B}" blue "${SHA_A}"
expect_target "runs when no rollback has ever been recorded on this host" "blue/${TAG_A}"

# --- 6c. The target never lands on the slot that is serving ------------------
# Skip one release in an alternating history and the next candidate is two back,
# on the SAME colour as the live one. Bringing it up there would recreate the
# containers serving live traffic. A is recorded on blue and blue is live, so
# the rollback must place A on green and switch there instead.
cat > "${WORK}/bg-history" <<EOF
2026-08-03T09:00:00Z blue ${TAG_A} ${SHA_A}
2026-08-03T10:00:00Z green ${TAG_C} ${SHA_C}
2026-08-03T11:00:00Z blue ${TAG_D} ${SHA_D}
EOF
cat > "${WORK}/rollbacks" <<EOF
2026-08-03T10:30:00Z ROLLBACK from=green/${TAG_C} to=blue/${TAG_D} targetSha=${SHA_D}
EOF
rm -f "${WORK}/state/proposed"
seed blue "${SHA_D}" green "${SHA_A}"
expect_target "brings the target up on the slot that is not serving" "green/${TAG_A}"

# --- 6d. ...so no upstream ever names one host twice -------------------------
# dashboard_static_upstream lists the outgoing dashboard as `backup`. When the
# target and the live release shared a slot that line named the same container
# as both primary and backup, which can serve no purpose.
# A host repeated across DIFFERENT upstream blocks is correct and expected —
# dashboard_upstream and dashboard_static_upstream both front the live dashboard.
# Only a repeat WITHIN one block is the defect, so check per block.
if [[ -s "${WORK}/state/proposed" ]]; then
  dupes="$(awk '
    /^upstream /             { block = $2; split("", seen); next }
    /^}/                     { block = ""; next }
    block != "" && /server / {
      if (match($0, /[a-z-]+:[0-9]+/)) {
        host = substr($0, RSTART, RLENGTH)
        if (host in seen) { print block " lists " host " twice" }
        seen[host] = 1
      }
    }
  ' "${WORK}/state/proposed")"
  if [[ -z "${dupes}" ]]; then
    ok "the emitted upstream never lists the same host twice"
  else
    no "the emitted upstream never lists the same host twice" "duplicated: ${dupes}"
  fi
else
  no "the emitted upstream never lists the same host twice" "no config was captured"
fi

# --- 6e. Legacy serving with nothing left to switch to is refused ------------
# The one remaining way for target and live to coincide. Restarting the serving
# containers in place is not a rollback, so it must refuse rather than proceed.
cat > "${WORK}/bg-history" <<EOF
2026-08-03T09:00:00Z blue ${TAG_A} ${SHA_A}
2026-08-03T10:00:00Z green ${TAG_B} ${SHA_B}
EOF
cat > "${WORK}/rollbacks" <<EOF
2026-08-03T10:30:00Z ROLLBACK from=green/${TAG_B} to=blue/${TAG_A} targetSha=${SHA_A}
2026-08-03T11:30:00Z ROLLBACK from=blue/${TAG_A} to=legacy/legacy targetSha=unknown
EOF
: > "${WORK}/legacy-history"
cat > "${WORK}/state/upstreams" <<'EOF'
upstream api_upstream {
    server api:3001;
}
upstream dashboard_upstream {
    server dashboard:3000;
}
EOF
: > "${WORK}/state/labels"
out="$(run_rollback)"; rc=$?
if (( rc != 0 )) && [[ "${out}" == *"no rollback target other than"* ]] \
   && ! grep -q 'nginx -s reload' "${WORK}/stub.log"; then
  ok "refuses when legacy is serving and nothing else is left"
else
  no "refuses when legacy is serving and nothing else is left" "rc=${rc} out=${out}"
fi

# --- 7. The mark is only written on success ----------------------------------
# A rollback that never reaches a healthy target must not record its intended
# target as rolled away from, or one failed attempt would exclude a good release.
cat > "${WORK}/bg-history" <<EOF
2026-08-03T09:00:00Z blue ${TAG_A} ${SHA_A}
2026-08-03T10:00:00Z green ${TAG_B} ${SHA_B}
EOF
: > "${WORK}/rollbacks"
seed green "${SHA_B}" blue "wrong-sha-so-the-image-check-refuses"
out="$(run_rollback)"; rc=$?
if (( rc != 0 )) && [[ ! -s "${WORK}/rollbacks" ]] \
   && ! grep -q 'nginx -s reload' "${WORK}/stub.log"; then
  ok "a failed rollback records nothing and never reloads nginx"
else
  no "a failed rollback records nothing and never reloads nginx" \
     "rc=${rc} rollbacks=$(cat "${WORK}/rollbacks") out=${out}"
fi

echo
echo "=== ${pass} passed, ${fail} failed ==="
(( fail == 0 ))
