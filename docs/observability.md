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

Base Compose keeps local `json-file` rotation for incident access through `docker logs`. Read-back access survives the overlay: when a log driver cannot be read back, Docker substitutes its own bounded local cache, so `docker logs` — and the blue/green deploy's health-gate diagnostic, which calls it — keep working under Fluentd. That cache is Docker's, with its own size defaults; the `json-file` rotation configured here does not apply to it.

To ship API/dashboard/maintenance/nginx output to a Fluentd-compatible collector, add the opt-in overlay:

```bash
docker compose \
  --env-file .env \
  -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.log-shipping.yml \
  config
```

Validate the rendered configuration first, then use the same files with `up -d`. The overlay uses asynchronous Fluentd delivery so a collector outage does not prevent Wizer from starting.

### What asynchronous delivery costs

`fluentd-async: 'true'` buys availability — Wizer keeps running when the collector does not — and pays for it in three ways that were measured directly during the off-box logging drill:

| Behaviour                                            | Measured                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| An unreachable collector is completely silent        | 0 of 33 lines delivered; container `running`, `docker logs` normal, **no daemon warning** |
| A collector blip drops whatever overflows the buffer | a 10 s outage under load lost **2945 of 4000 lines** at Docker's 1 MiB default            |
| The tail before a container exits is not flushed     | 8 of 300 lines never shipped — the lines that explain _why_ it exited                     |

Three consequences follow.

**The address is resolved by the Docker daemon on the host, not from inside the container network.** A value that looks correct — a Compose service name, a hostname only present on the container network — will connect from nowhere and ship nothing, forever, without a single error. Production preflight opens a TCP connection to `LOG_SHIPPING_ADDRESS` from the host for exactly this reason, retrying three times so a momentary blip does not block a release. If the collector is genuinely down and the release must ship anyway, `ALLOW_UNREACHABLE_LOG_COLLECTOR=1` proceeds with a loud warning — logs from that release are dropped until the collector returns.

**Raising `LOG_SHIPPING_BUFFER_LIMIT` does not buy durability.** It is a _count of buffered events_, not a byte size — verified directly: with the limit at 10, containers emitting 4-byte and 400-byte lines both delivered 11 messages after reconnecting. And raising it does not reduce loss: over a ten-second outage with 4000 lines in flight, `1048576` delivered 1092 and `8388608` delivered 1097 — indistinguishable. Whatever async delivery discards during an outage is not governed by this ceiling, so an increase only enlarges a per-container channel inside `dockerd`. It is left at Docker's default deliberately. **Loss is made visible by the canary below, not prevented by tuning.**

**Off-box logs are lossy at exactly the moment they matter most.** Docker enables a local file cache automatically when a log driver cannot be read back, so `docker logs` still works under the overlay and generally retains what the off-box copy dropped. That cache is a bounded local ring buffer with its own defaults — it is _not_ the `json-file` rotation configured in base Compose, and it is not a substitute for retention. During an incident, reach for the host first and the collector second, but do not assume either holds a complete record.

### Proving logs still leave the host

The maintenance worker emits one structured line every five minutes carrying a fixed marker (`scripts/log-shipping-canary.sh`):

```json
{
  "level": "info",
  "logger": "log-shipping-canary",
  "marker": "wizer.log-shipping.canary",
  "host": "...",
  "at": "...",
  "release": "..."
}
```

That line travels the whole delivery path — daemon, network, collector, ingest — so its **absence at the collector** is the signal. Nothing on the Wizer host can raise this alarm credibly, for the same reason the database backup uses an external dead-man switch: the container that would report the failure is inside the failure.

Configure this on the collector, once:

1. Match received lines containing `wizer.log-shipping.canary`.
2. On each match, ping a dead-man URL (healthchecks.io or equivalent).
3. Set that check's period to **at least three times the cron interval** — 15 minutes or more — so a single missed tick is not a page.

Without step 2 the canary is just another log line and proves nothing. `maintenance-runtime.spec.ts` pins the marker in the script against the one printed here, so the two cannot drift apart and silently disarm the alert.

## Recommended alerts

Start with service-level alerts rather than one Prometheus alert series per screen:

- public readiness unavailable;
- elevated 5xx rate;
- p95/p99 route latency above SLO;
- unexpected API uptime reset/restart;
- memory approaching container limit;
- backup dead-man check missed;
- **log-shipping canary missed** — off-box delivery has stopped (see “Proving logs still leave the host” above);
- **nightly dead-man missed** — the nightly workflow failed, or stopped running altogether (see below);
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

## Knowing the nightly still runs

The nightly workflow (`.github/workflows/nightly.yml`) carries the checks that must not gate every push but must not go unrun either: the k6 load smoke with its p95/error thresholds, the backup-and-restore drill, and the production dependency audit.

It failed on six consecutive nights without reaching anyone, and the k6 smoke inside it had never executed once. Two mechanisms now report on it, because they fail in different directions.

**A tracking issue**, opened on the first failure and commented on thereafter — one issue, not one per night, because a nightly issue is noise and noise gets muted. It closes itself when the nightly is green again. This needs no configuration and works from the first run.

**A dead-man ping**, sent only when every job succeeded. This is the half that catches what a failure notification structurally cannot: GitHub **disables scheduled workflows after 60 days without repository activity**, and a workflow that never runs never fails. An external check alarms on "failed" and "never ran" alike.

To enable the dead-man, set a repository secret:

```
NIGHTLY_HEALTHCHECK_URL = https://hc-ping.com/<uuid>
```

Give that check a period of **~26 hours** — comfortably longer than the daily schedule, so one slow queue does not page anyone. When the secret is absent the step logs that no ping was sent and exits 0: an unconfigured dead-man must never be a red build, or the alerting becomes the noise it exists to prevent.
