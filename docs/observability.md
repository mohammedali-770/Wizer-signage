# Production observability

Wizer uses a first-party observability stack so a monitoring vendor outage is not a runtime dependency.

## Structured API logs

In production the Nest API uses Nest 11's native JSON `ConsoleLogger`. Existing `Logger` calls therefore become one machine-readable JSON event per line. `LOG_LEVEL` still controls verbosity; `LOG_FORMAT=json` can opt non-production environments into the same format.

The existing request performance logger remains bounded to safe request metadata. Do not add cookies, authorization headers, request bodies, refresh tokens or storage contents to logs.

## Dashboard client errors

`src/instrumentation-client.ts` captures authenticated browser `error` and `unhandledrejection` events and sends a bounded payload to `POST /api/client-telemetry/error` using the existing user access token.

Before upload Wizer:

- strips URL origins/query strings from source locations;
- scrubs URLs, email-like values and long numeric identifiers from messages;
- never sends browser local storage, cookies, request bodies or stack traces;
- groups errors by a deterministic 24-hex fingerprint;
- deduplicates the same fingerprint for 60 seconds in one browser session.

The API writes accepted client events into the same JSON log stream with authenticated `companyId`/`userId`, so off-box logs can correlate frontend and backend failures without a separate SDK.

## Prometheus-compatible API metrics

The API exposes `GET /api/internal/metrics`. It bypasses a human JWT only for automated scraping and requires:

`X-Wizer-Metrics-Token: <METRICS_TOKEN>`

`METRICS_TOKEN` must be at least 32 characters. Missing/weak configuration fails closed with 503; a wrong token returns 401.

Metrics intentionally stay low-cardinality:

- process uptime;
- RSS and heap used;
- active HTTP requests;
- request count by method, normalized Express route and status class;
- request-duration histogram by the same bounded labels.

Never add company, user, screen, content, request ID, raw URL or query-string labels.

## Android crash and version fleet diagnostics

The Android player already stores the previous uncaught crash locally for recovery diagnostics. Wizer now converts that file into only:

- crash timestamp;
- 24-hex SHA-256 fingerprint prefix;
- cumulative local crash count;
- player app version.

The stack trace never leaves the TV. The pending crash survives offline restarts and is cleared only after the authenticated `/api/device/crash-report` endpoint accepts it.

The server stores the latest bounded crash snapshot beside the screen capabilities and exposes company-scoped `GET /api/monitoring/fleet-health` (requires `ScreenRead`) with:

- player version distribution;
- up to 100 most recent valid crash snapshots;
- screen name/status/heartbeat context.

A recovered crash is diagnostic only and does not change the screen health state.

## Off-box logs

Base Compose keeps local `json-file` rotation for incident access through `docker logs`.

To ship API/dashboard/maintenance/nginx output to a Fluentd-compatible collector, add the opt-in overlay:

```bash
docker compose \
  --env-file .env \
  -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.log-shipping.yml \
  config
```

Validate the rendered configuration first, then use the same files with `up -d`. The overlay uses asynchronous Fluentd delivery so a collector outage does not prevent Wizer from starting. Monitor the collector independently.

## Recommended alerts

Start with service-level alerts rather than one Prometheus alert series per screen:

- public readiness unavailable;
- elevated 5xx rate;
- p95/p99 route latency above SLO;
- unexpected API uptime reset/restart;
- memory approaching container limit;
- backup dead-man check missed;
- TLS expiry check failed;
- player version fragmentation;
- concentration of the same Android crash fingerprint after a release.

Per-screen offline/warning notifications remain in Wizer's application alerting layer.

## Correlation workflow

1. Start from readiness/alert time.
2. Use service metrics to identify route/status/latency class.
3. Query off-box JSON logs around that window.
4. Correlate request IDs for server failures or dashboard client-error fingerprints for browser failures.
5. Use activity logs for operator changes and fleet-health data for Android-version/crash clusters.

This is the production error/metrics equivalent required by the readiness plan; Sentry can be added later as an optional visualization/alerting vendor, not as a prerequisite for Wizer availability.
