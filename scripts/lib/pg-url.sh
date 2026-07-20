#!/usr/bin/env bash
# =============================================================================
# Wizer Signage — Postgres connection-URL helpers for pg_dump / psql
# =============================================================================
# Sourcing this file defines FUNCTIONS ONLY. It has no side effects and never
# prints a connection URL, credential, or host to stdout/stderr — callers
# capture the resolved URL via command substitution, so it never lands in a log.
#
# WHY THIS EXISTS:
#   The production DATABASE_URL is the Supabase *pooled* (PgBouncer) Prisma URL
#   and carries `pgbouncer=true` (plus other Prisma-only params). libpq / pg_dump
#   reject those: `invalid URI query parameter: "pgbouncer"`. The non-pooled
#   DIRECT_URL is the correct endpoint for pg_dump/psql, so we prefer it and fall
#   back to a *sanitized* DATABASE_URL only when DIRECT_URL is absent.
# =============================================================================

# Query-string parameters understood by Prisma / PgBouncer but NOT by libpq.
# Conservative, explicit allow-to-strip list — we never touch anything else
# (e.g. `sslmode` is a valid libpq param and is preserved).
PG_STRIP_PARAMS="pgbouncer connection_limit pool_timeout statement_cache_size schema"

# _pg_trim <string> -> echoes the string with surrounding whitespace removed.
_pg_trim() {
  local s="$1"
  # strip leading, then trailing, whitespace
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# pg_strip_prisma_params <url>
#   Echoes <url> with any PG_STRIP_PARAMS removed from its query string. If the
#   query string becomes empty the trailing "?" is dropped. A URL without a
#   query string is returned unchanged. Only the portion AFTER the first "?" is
#   parsed, so percent-encoded credentials (before it) are never touched.
pg_strip_prisma_params() {
  local url="$1"
  case "$url" in
    *\?*) : ;;                       # has a query string — fall through
    *) printf '%s' "$url"; return 0 ;;
  esac

  local base="${url%%\?*}"
  local query="${url#*\?}"
  # Drop any URI fragment (RFC 3986: an unencoded "#" always delimits the
  # fragment; real credentials/values use %23). Otherwise a trailing "#frag"
  # would stay glued to the last kept parameter (e.g. sslmode=require#frag) and
  # be handed to pg_dump. Only the query portion is touched, so the credential
  # part (before "?") is never altered.
  query="${query%%#*}"
  local rebuilt="" kv key drop p
  local old_ifs="$IFS"

  # Split the query on "&" into an array, then restore IFS BEFORE the inner loop
  # so the space-separated PG_STRIP_PARAMS list word-splits correctly (a stray
  # IFS='&' here would collapse it into a single word and strip nothing).
  local -a pairs=()
  IFS='&' read -r -a pairs <<< "$query"
  IFS="$old_ifs"

  for kv in "${pairs[@]}"; do
    [ -n "$kv" ] || continue
    key="${kv%%=*}"
    drop=0
    for p in $PG_STRIP_PARAMS; do
      if [ "$key" = "$p" ]; then drop=1; break; fi
    done
    if [ "$drop" -eq 0 ]; then
      if [ -z "$rebuilt" ]; then rebuilt="$kv"; else rebuilt="$rebuilt&$kv"; fi
    fi
  done

  if [ -n "$rebuilt" ]; then
    printf '%s?%s' "$base" "$rebuilt"
  else
    printf '%s' "$base"
  fi
}

# pg_url_has_pgbouncer <url> -> returns 0 if the query string contains pgbouncer=
pg_url_has_pgbouncer() {
  case "$1" in
    *\?pgbouncer=*|*\&pgbouncer=*) return 0 ;;
    *) return 1 ;;
  esac
}

# resolve_pg_dump_url
#   Reads DIRECT_URL and DATABASE_URL from the environment. Echoes (stdout only)
#   the sanitized URL that pg_dump/psql should use, or writes a SECRET-FREE error
#   to stderr and returns non-zero. Prefers DIRECT_URL when non-empty; otherwise
#   falls back to DATABASE_URL. In both cases Prisma-only params are stripped so
#   a pooled URL is NEVER handed to pg_dump unchanged.
#
#   Diagnostics naming the *variable* (never its value) are written to stderr.
resolve_pg_dump_url() {
  local direct database chosen source_name sanitized
  direct="$(_pg_trim "${DIRECT_URL:-}")"
  database="$(_pg_trim "${DATABASE_URL:-}")"

  if [ -n "$direct" ]; then
    chosen="$direct"; source_name="DIRECT_URL"
  elif [ -n "$database" ]; then
    chosen="$database"; source_name="DATABASE_URL"
  else
    echo "ERROR: neither DIRECT_URL nor DATABASE_URL is set; cannot run pg_dump/psql." >&2
    return 1
  fi

  sanitized="$(pg_strip_prisma_params "$chosen")"

  if pg_url_has_pgbouncer "$chosen"; then
    # Never print the URL — only the variable name and the action taken.
    echo "[pg-url] Using ${source_name}; removed Prisma/PgBouncer-only query params unsupported by pg_dump." >&2
  else
    echo "[pg-url] Using ${source_name} for pg_dump/psql." >&2
  fi

  printf '%s' "$sanitized"
  return 0
}
