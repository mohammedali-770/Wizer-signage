# Performance & Load Testing (Phase 11)

A small foundation for sanity-checking capacity — **not** a full performance
suite. Use it to establish a baseline and to catch regressions, on **local or
staging** environments.

> ⚠️ Do not run load tests against production without a planned window. Heavy
> traffic can trip rate limits, exhaust the Supabase connection pool, generate
> alerts, and skew proof-of-play/heartbeat data.

## Tooling

The provided script uses **[k6](https://k6.io)** (single static binary, scriptable).
`autocannon` (npm) or `hey` work for quick one-offs too.

```bash
# Install k6 (Linux): https://grafana.com/docs/k6/latest/set-up/install-k6/
k6 run -e BASE_URL=http://localhost:3001/api scripts/load-test/smoke.js
```

## What to exercise

| Endpoint                                | Why                                               | Auth         |
| --------------------------------------- | ------------------------------------------------- | ------------ |
| `GET /api/health` · `/health/ready`     | liveness/readiness under load                     | none         |
| `POST /api/auth/login`                  | password hashing (Argon2) is intentionally costly | none         |
| `GET /api/device/manifest`              | resolver — the player's hot path                  | device token |
| `GET /api/device/sync-plan`             | offline-cache entitlement compute                 | device token |
| `GET /api/device/content/:id/download`  | range streaming / proxy                           | device token |
| `POST /api/device/heartbeat`            | high-frequency device writes                      | device token |
| `POST /api/device/proof-of-play/events` | batched event ingest                              | device token |
| `GET /api/monitoring/overview`          | fleet dashboard aggregation                       | JWT          |

`scripts/load-test/smoke.js` covers health + (optionally, with `-e TOKEN=` and
`-e DEVICE_TOKEN=`) the monitoring overview, manifest, and sync-plan. Extend it
with `http.post` for heartbeat/proof-of-play once you have a device token from a
paired test screen.

## Metrics to watch

- **p95 / p99 latency** per endpoint (k6 `http_req_duration`).
- **Error rate** (`http_req_failed` — keep < 1%).
- **DB connection pool**: Supabase pooler (pgBouncer) saturation — watch for
  `remaining connection slots` errors; size the pool for your VPS.
- **CPU/memory** of the api container (`docker stats`) vs. the compose limits.
- **Rate limiting**: the API throttles at 100 req/min per IP by default
  (`ThrottlerModule`); load tests from one IP will hit it — raise the limit or
  exempt the test IP deliberately, don't disable it globally.

## Tuning levers

- Scale the `api` service horizontally (`docker compose up -d --scale api=N` +
  add the replicas to the nginx upstream) — the API is stateless.
- Adjust `deploy.resources.limits` in the compose for your hardware.
- Tune `SESSION_INACTIVITY_TIMEOUT_MINUTES`, manifest refresh, and heartbeat
  intervals (device config) to trade freshness for load.
- Move heavy maintenance (retention) to off-peak (it already runs nightly).

## Capacity notes

- Heartbeats (~1/min/screen) and proof-of-play (1 row/play) are the dominant
  write load — size retention + the DB accordingly (`RETENTION_DAYS`).
- Content downloads stream through nginx (`proxy_request_buffering off`,
  512 MB body limit); large fleets pulling a new asset simultaneously is the
  spikiest path — Supabase Storage + the per-device cache (Phase 7) absorb most
  of it.
