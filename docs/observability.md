# Production observability

Wizer's production observability is deliberately layered so the application remains usable when an external monitoring vendor or log collector is unavailable.

## API structured logs

When `NODE_ENV=production`, the Nest API uses Nest 11's native JSON `ConsoleLogger`. Existing `Logger` calls therefore remain intact but are emitted as one structured JSON object per line, which is suitable for Docker collection and off-box shipping.

`LOG_LEVEL` still controls verbosity. `LOG_FORMAT=json` can opt staging/development into the same machine-readable format.

Request/response bodies, cookies, authorization headers and query values are not added to the performance log. Slow-request logs continue to carry correlation ID plus safe method/path/status/duration metadata.

## Prometheus-compatible API metrics

The API exposes:

`GET /api/internal/metrics`

This endpoint bypasses a human JWT only so an automated scraper can call it. It is protected by a separate secret header:

`X-Wizer-Metrics-Token: <METRICS_TOKEN>`

`METRICS_TOKEN` must be at least 32 characters. When it is missing or weak the endpoint returns 503; an invalid token returns 401. Do not put the token in a URL/query string.

The registry intentionally exposes a small bounded set of service-level signals:

- process uptime;
- resident memory;
- heap used;
- active HTTP requests;
- request counts by method, normalized route and status class;
- request-duration histogram by the same bounded labels.

It deliberately does **not** label metrics by company, user, screen, request ID, raw URL, query value, or content ID. Those dimensions create unbounded Prometheus cardinality and belong in logs/database analytics instead.

Example Prometheus scrape configuration:

```yaml
scrape_configs:
  - job_name: wizer-api
    scheme: https
    metrics_path: /api/internal/metrics
    static_configs:
      - targets: [signage.wizer.sa]
    http_headers:
      X-Wizer-Metrics-Token:
        values: ["<secret from the metrics scraper secret store>"]
```

If the selected Prometheus deployment/version does not support static custom headers directly, place the scraper behind a private reverse proxy/agent that injects this header rather than weakening the Wizer endpoint.

## Recommended alerts

Start with service-level alerts rather than per-screen paging:

- readiness probe unavailable;
- 5xx request rate above normal baseline;
- p95/p99 request latency above the agreed SLO;
- API restart/uptime reset unexpectedly;
- memory growth approaching the container limit;
- dead-man backup check missed;
- TLS expiry check failed;
- fleet offline/crash-version concentration (from screen telemetry).

Device-specific offline alerts already belong to Wizer's application monitoring/alerting layer and should not become one Prometheus alert series per screen.

## Off-box container logs

The normal compose file retains Docker `json-file` logging with local rotation. This remains the safe default and supports `docker logs` during an incident.

To ship API/dashboard/maintenance/nginx output to a Fluentd-compatible collector, include the opt-in overlay:

```bash
docker compose \
  --env-file .env \
  -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.log-shipping.yml \
  up -d
```

Set `LOG_SHIPPING_ADDRESS` before using the overlay. It uses Docker's asynchronous Fluentd mode so loss of the remote collector does not prevent Wizer containers from starting. Monitor the collector separately; async delivery is not a substitute for collector health alerts.

Validate the resolved compose configuration before enabling it in production:

```bash
docker compose \
  --env-file .env \
  -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.log-shipping.yml \
  config
```

## Correlation workflow

1. Start with the public readiness/smoke result or alert timestamp.
2. Use API metrics to identify status/latency class and affected normalized route.
3. Use structured logs for the same time window and request ID to identify the concrete failure.
4. Use activity/audit records for operator-caused configuration changes.
5. Use screen heartbeat/version/crash telemetry for fleet-specific failures.

This separation keeps metrics low-cardinality, logs diagnostic, and the database authoritative for tenant/audit history.

## Sentry status

Sentry is intentionally a separate optional layer rather than a hard runtime dependency. The production design target is:

- official Sentry NestJS SDK for API exceptions;
- official Sentry Next.js SDK for dashboard server/client exceptions;
- release/environment metadata tied to immutable Git SHA;
- source maps uploaded only from the release workflow;
- no secrets, tokens, request bodies or tenant PII deliberately attached as Sentry context.

Do not enable an ad-hoc CDN/browser-only Sentry snippet. Add the official SDK packages and committed lockfile together, then run the repository's full dependency/security/build gate before activation.
