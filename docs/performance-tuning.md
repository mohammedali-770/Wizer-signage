# Performance Tuning

A measure-first audit of the dashboard + API + database + infra, and the
optimizations applied. The system was already well-built (pagination caps,
standalone Docker, gzip/HTTP-2/immutable static caching, ALS-based tenant context
with no per-request DB lookups); this pass closed the remaining real gaps and
added instrumentation so timings can be measured on production.

## How to measure (do this before & after)

**Server-side timing (no extra tooling):**

- Slow requests are always logged at WARN: `SLOW GET /api/screens 200 1240ms company=… user=…`.
- Log **every** request line by setting `PERF_LOG_REQUESTS=true`.
- Log **Prisma SQL + duration** (never params/values) with `PERF_LOG_QUERIES=true`;
  slow queries are tagged using `PERF_SLOW_QUERY_MS` (default 50ms).

```bash
# On the VPS, tail timings for a few minutes of real usage:
docker compose --env-file .env -f infra/docker/docker-compose.yml logs -f api | grep -E "SLOW|query "
```

**Browser-side:** DevTools → Network. Compare the number of requests and total
load time on the heavy pages (screen detail, company overview) before/after, and
re-navigate between pages to see cache hits (no network call within the 30s TTL).

| Env var              | Default | Effect                                                      |
| -------------------- | ------- | ----------------------------------------------------------- |
| `PERF_LOG_REQUESTS`  | off     | Log every request (method/path/status/ms + company/user id) |
| `PERF_SLOW_MS`       | `1000`  | Request duration that triggers a SLOW warning               |
| `PERF_LOG_QUERIES`   | off     | Log Prisma SQL + duration (never the bound params)          |
| `PERF_SLOW_QUERY_MS` | `50`    | Query duration tagged SLOW in query logs                    |

These never log bodies, headers, cookies, tokens, or query-string values.

## Bottlenecks found & fixed

### Dashboard

- **No client cache** — `useApiResource` refetched on every mount/navigation.
  **Fix:** added a 30s in-memory cache + request dedup + keep-previous-data to the
  hook (no React Query rewrite). Revisiting a page within the TTL is now instant;
  duplicate concurrent calls collapse to one. Cache is cleared on login/logout so
  it never leaks across sessions in the same tab.
- **Screen detail fired 9 calls on mount**, 3 of them (locations/tags/groups) only
  used inside dialogs. **Fix:** those lookups now load only when their dialog
  opens, and are cached for instant reopen — ~3 fewer calls on every screen open.

### API / Database

- **Heartbeat "latest per screen"** lookup (runs on every monitoring/fleet read)
  scanned + sorted all of a screen's heartbeats. **Fix:** `@@index([screenId, createdAt])`.
- **Alert dedup** lookup (every heartbeat/sweep event) filtered `(dedupeKey, status)`
  with only a `dedupeKey` index. **Fix:** `@@index([dedupeKey, status])`.
- **Activity-log** tenant time-range views. **Fix:** `@@index([companyId, createdAt])`.

Migration: `apps/api/prisma/migrations/20260623120000_perf_indexes`. On a fresh
DB these create instantly. **If `heartbeats` is already very large**, create the
indexes manually with `CREATE INDEX CONCURRENTLY` during low traffic instead
(Prisma runs migrations in a transaction, where `CONCURRENTLY` is not allowed),
then `prisma migrate resolve --applied 20260623120000_perf_indexes`.

### Infra

- nginx: added legacy JS gzip MIME types and defensive
  `proxy_no_cache`/`proxy_cache_bypass` on `/api/`. (gzip, HTTP/2, immutable
  static caching, and security headers were already correct.) An earlier version
  of this note also claimed `gzip off` on a `/ws` location; there is no `/ws`
  location and no `gzip off` directive in the config — devices poll over HTTPS.

## Estimated impact

- Dashboard navigation between already-visited pages: from a full refetch to an
  instant cache hit (perceived "snappy"); fewer redundant API calls overall.
- Screen detail open: ~3 fewer API calls.
- Monitoring/fleet reads and alert dedup: index seeks instead of scans — the
  benefit grows with heartbeat/alert/activity-log volume (i.e. as branches/screens
  are added, which is exactly the stated concern).

## Recommended (NOT applied — higher risk / needs a decision)

- **Brotli compression**: stock `nginx:1.27-alpine` has gzip but not brotli.
  Adding it means switching to a brotli-enabled image (custom build or the Debian
  `nginx:1.27`), which changes the running proxy image — deferred to avoid
  disturbing the live TLS deployment. ~15–20% smaller text assets if adopted.
- **Monitoring overview**: aggregates status by loading all of a company's screens
  in memory. Fine for hundreds of screens; for very large fleets, move the counts
  to a SQL `groupBy`. Medium-risk refactor (changes a hot read path) — measure
  first with `PERF_LOG_QUERIES` once fleets grow.
- **Lightweight list DTOs**: list endpoints already paginate (cap 100) and use
  modest includes; slimming `select`s further is low-value until payloads are
  shown to be a bottleneck by the instrumentation above.

## Verify on production

```bash
curl -s -o /dev/null -w "%{time_total}s\n" https://wizer.sa/api/health
# After deploy, exercise the dashboard and watch: docker compose ... logs -f api | grep SLOW
```
