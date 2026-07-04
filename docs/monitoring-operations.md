# Monitoring & Operations (Phase 11)

How to observe a running Wizer Signage deployment. This is a **foundation** —
structured app logs to stdout, container log rotation, and recommendations — not
a bundled observability stack.

## Logs

Everything logs to **stdout/stderr** and is captured by Docker's `json-file`
driver with rotation (`max-size=10m, max-file=5`, set per service in the compose).

| Source                    | View                                                            |
| ------------------------- | --------------------------------------------------------------- |
| API                       | `docker compose -f infra/docker/docker-compose.yml logs -f api` |
| Dashboard                 | `… logs -f dashboard`                                           |
| Maintenance (cron + jobs) | `… logs -f maintenance`                                         |
| Nginx access/error        | `… logs -f nginx` (or mount `/var/log/nginx`)                   |

- **API request logging** is handled at the edge by **nginx access logs**
  (method, path, status, bytes, referrer, UA, forwarded-for) — see the `main`
  `log_format` in `infra/nginx/nginx.conf`. The API logs application events,
  warnings, and errors via the Nest `Logger`; **secrets are never logged**
  (password/2FA/token fields are excluded by design).
- **Maintenance logs** show each cron run (`sweep`/`reports`/`emergencies`/`all`)
  and the nightly backup, with the per-run JSON result.
- **Email delivery** is auditable in the `EmailDeliveryLog` table (not the logs).
- **Backups** are auditable at **/admin/backups** + the `BackupRecord` table.

### Log rotation

Container logs rotate via the compose `logging` options. For host-level files
(nginx if mounted, host cron output), add a `logrotate` rule or cap with
`journald`. Avoid unbounded `/var/log` growth.

## In-product operational signals (reuse Phase 8–10)

- **Fleet health** — `/company/monitoring` (online/offline/warning, sync, last
  heartbeat) + screen-health export.
- **Alerts** — `/company/alerts` + the notification bell (offline screens,
  storage/subscription/grace, backup/report failures). System alerts (companyId
  null) surface to Super Admins.
- **Backup health** — `/admin/backups` (last successful DB backup + staleness).
- **Proof-of-play / reports** — `/company/reports/*`.

## Health endpoints (for external uptime monitors)

- `GET /api/health` — liveness (status/version/uptime). Public, lightweight.
- `GET /api/health/ready` — readiness; verifies DB connectivity, returns **503**
  when not ready. Exposes only booleans (`database: up|down`, `storageConfigured`,
  `mailConfigured`) — safe to poll without auth.

Point an uptime monitor (UptimeRobot, BetterStack, Pingdom, or your provider's
health check) at `https://$APP_DOMAIN/api/health/ready` and the dashboard `/`.

## Optional integrations (placeholders — not bundled)

Wire these in if/when you need them; none are required:

- **Sentry** — add `@sentry/node` (API) / `@sentry/nextjs` (dashboard), init in
  `main.ts` / `instrumentation.ts` behind a `SENTRY_DSN` env. Scrub PII.
- **Prometheus / OpenTelemetry** — add `@nestjs/terminus` + a `/metrics`
  endpoint (internal-only, not via nginx) or an OTel SDK exporter; scrape with
  Prometheus + Grafana.
- **Uptime monitoring** — external HTTP checks on the health endpoints above.

Keep `/metrics` and any debug endpoints **internal-only** (never proxied by
nginx to the public internet).

## Routine operations

- **Trigger maintenance now:** `POST /api/admin/maintenance/run {"job":"all"}`
  (Super Admin) or `docker compose ... exec maintenance node dist/maintenance/maintenance.cli.js all`.
- **Manual backup:** `docker compose ... exec maintenance bash scripts/backup-db.sh`.
- **Restore:** see [backup-restore.md](./backup-restore.md).
- **Retention policy / cron:** see [data-retention.md](./data-retention.md).
