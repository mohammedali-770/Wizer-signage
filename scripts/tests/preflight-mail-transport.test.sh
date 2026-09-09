#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — production-preflight.sh mail transport selection
# =============================================================================
# The preflight used to require SMTP_HOST and SMTP_PORT unconditionally. That is
# wrong on a host that cannot speak SMTP at all: DigitalOcean blocks TCP 25, 465
# and 587 on every Droplet by default, and ZeptoMail publishes no alternate
# submission port, so a correctly-configured Droplet on the HTTPS transport has
# no SMTP_HOST to give — and the deploy aborted before it could start.
#
# The functions are EXTRACTED FROM THE SCRIPT rather than copied here, so these
# cases exercise the shipped code and cannot drift from it.
#
# Usage:  bash scripts/tests/preflight-mail-transport.test.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PREFLIGHT="${ROOT_DIR}/scripts/production-preflight.sh"

pass=0; fail=0
ok() { echo "  ok   — $1"; pass=$(( pass + 1 )); }
no() { echo "  FAIL — $1"; echo "         $2"; fail=$(( fail + 1 )); }

for fn in resolve_mail_transport mail_required_keys zeptomail_endpoint_is_secure; do
  body="$(sed -n "/^${fn}() {/,/^}/p" "${PREFLIGHT}")"
  [[ -n "${body}" ]] || { echo "could not extract ${fn} from ${PREFLIGHT}" >&2; exit 1; }
  eval "${body}"
done

# Stands in for the real .env reader; only MAIL_TRANSPORT is consulted here.
STUB_MAIL_TRANSPORT=""
read_env_value() {
  [[ "$1" == "MAIL_TRANSPORT" ]] && printf '%s' "${STUB_MAIL_TRANSPORT}"
  return 0
}

echo "=== production-preflight.sh mail transport ==="

# --- resolve_mail_transport -------------------------------------------------
# accepts <label> <raw value> <expected>
accepts() {
  STUB_MAIL_TRANSPORT="$2"
  local got status
  got="$(resolve_mail_transport)"; status=$?
  if (( status == 0 )) && [[ "${got}" == "$3" ]]; then
    ok "resolves $1"
  else
    no "resolves $1" "expected '$3' (exit 0), got '${got}' (exit ${status})"
  fi
}
# rejects <label> <raw value>
rejects() {
  STUB_MAIL_TRANSPORT="$2"
  local got status
  got="$(resolve_mail_transport)"; status=$?
  if (( status != 0 )); then ok "rejects $1"; else no "rejects $1" "accepted as '${got}'"; fi
}

accepts "an unset MAIL_TRANSPORT to the smtp default" ""              "smtp"
accepts "whitespace to the smtp default"              "   "           "smtp"
accepts "an explicit smtp"                            "smtp"          "smtp"
accepts "the ZeptoMail API transport"                 "zeptomail-api" "zeptomail-api"

# A typo must not coerce to smtp: on a Droplet that means every send fails while
# readiness still reports mail configured.
rejects "an underscore typo"        "zeptomail_api"
rejects "a capitalised variant"     "ZEPTOMAIL-API"
accepts "a trailing-space variant to the API transport" "zeptomail-api " "zeptomail-api"
accepts "a leading-space variant to the API transport"  " zeptomail-api" "zeptomail-api"

rejects "an unrelated provider"     "sendgrid"
rejects "a partial match"           "zeptomail"

# --- mail_required_keys -----------------------------------------------------
# requires <label> <transport> <key>
requires() {
  if [[ " $(mail_required_keys "$2") " == *" $3 "* ]]; then
    ok "$1"
  else
    no "$1" "'$3' absent from: $(mail_required_keys "$2")"
  fi
}
# omits <label> <transport> <key>
omits() {
  if [[ " $(mail_required_keys "$2") " == *" $3 "* ]]; then
    no "$1" "'$3' wrongly required for '$2': $(mail_required_keys "$2")"
  else
    ok "$1"
  fi
}

requires "smtp requires SMTP_HOST"                  smtp          SMTP_HOST
requires "smtp requires SMTP_PORT"                  smtp          SMTP_PORT
requires "smtp requires SMTP_FROM"                  smtp          SMTP_FROM
omits    "smtp does not require ZEPTOMAIL_API_KEY"  smtp          ZEPTOMAIL_API_KEY

requires "the API transport requires ZEPTOMAIL_API_KEY" zeptomail-api ZEPTOMAIL_API_KEY
requires "the API transport still requires SMTP_FROM"   zeptomail-api SMTP_FROM

# The regression that blocked the deploy outright: a Droplet on the HTTPS
# transport has no SMTP host or port to declare.
omits    "the API transport does not require SMTP_HOST" zeptomail-api SMTP_HOST
omits    "the API transport does not require SMTP_PORT" zeptomail-api SMTP_PORT

# --- zeptomail_endpoint_is_secure -------------------------------------------
secure() {
  if zeptomail_endpoint_is_secure "$2"; then ok "accepts $1"; else no "accepts $1" "rejected: '$2'"; fi
}
insecure() {
  if zeptomail_endpoint_is_secure "$2"; then no "rejects $1" "accepted: '$2'"; else ok "rejects $1"; fi
}

secure   "an unset override (built-in endpoint)" ""
secure   "the documented https endpoint"         "https://api.zeptomail.com/v1.1/email"
secure   "a regional https endpoint"             "https://api.zeptomail.eu/v1.1/email"
insecure "a plaintext endpoint"                  "http://api.zeptomail.com/v1.1/email"
insecure "a scheme-less host"                    "api.zeptomail.com/v1.1/email"
insecure "a lookalike scheme"                    "httpx://api.zeptomail.com/v1.1/email"
# A prefix check alone accepts these. They have no host, so every send fails
# while the readiness probe still reports mail configured.
insecure "a hostless https"                      "https://"
insecure "an empty authority"                    "https:///v1.1/email"
insecure "userinfo with no host"                 "https://user@"

echo
echo "passed: ${pass}  failed: ${fail}"
(( fail == 0 )) || exit 1
