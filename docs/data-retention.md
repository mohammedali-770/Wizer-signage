# Data Retention & Maintenance (Phase 10)

Operational/telemetry data is pruned on a retention window; financial records are
kept forever. Everything is driven by a **maintenance CLI** run from cron — there
is no in-process scheduler (deliberately, to avoid overbuilding).

## What the maintenance runner does

`runAll()` (one cron tick) performs, in order:

1. **Alert sweep** — reconciles time/threshold alerts (offline screens,
   subscription expiry, grace ending, storage near/exceeded, plan-limit exceeded,
   content expiring). Deduplicated + auto-resolving, so it is safe to run often.
2. **Retention cleanup** — deletes data older than `RETENTION_DAYS` (default 90):
   - `ProofOfPlay` (by `startedAt` — the actual playback time)
   - `Heartbeat` history (by `createdAt`)
   - `Screenshot` rows **+ their storage objects** (by `takenAt`)
   - `Alert` rows that are **RESOLVED/DISMISSED** (OPEN/ACK are always kept)
   - `EmailDeliveryLog` (by `createdAt`)
   - `ScheduledReportDelivery` rows **+ their stored files**
   - **Content trash** older than 14 days (via the existing content cleanup)
3. **Emergency auto-END** — see below.
4. **Scheduled reports** — runs every enabled report whose `nextRunAt` is due.
5. **Backup recency check** — raises a system alert if the database has not had a
   successful backup recently.

### Never deleted

**Invoices and subscriptions are financial records and are NEVER deleted by
retention.** (The retention service has no code path that touches them.) Keep
long-term/offsite copies per your legal requirements.

### Retention window

`RETENTION_DAYS` (default 90). A plan may also carry a `dataRetentionDays` limit;
the env default applies platform-wide today. Content trash uses its own 14-day
policy (`CONTENT_TRASH_RETENTION_DAYS`).

## Emergency auto-END (completes Phase 9's deferred behavior)

`EmergencyBroadcastService.endExpired()` finds `ACTIVE`/`SCHEDULED` broadcasts
whose `endAt` has passed, ends each (status `ENDED`, `stoppedAt` set), **dispatches
`REFRESH_MANIFEST` to affected screens** so they revert to schedule, and logs
`emergency.auto_ended`. **Idempotent** — already-ended broadcasts are skipped, and
the resolver already ignores a past-`endAt` emergency, so playback stops even
before the job runs.

## Running it (cron / worker)

Build the API, then run the CLI:

```bash
# All jobs (typical nightly tick):
node apps/api/dist/maintenance/maintenance.cli.js all

# Individual jobs:
node apps/api/dist/maintenance/maintenance.cli.js sweep
node apps/api/dist/maintenance/maintenance.cli.js retention
node apps/api/dist/maintenance/maintenance.cli.js reports
node apps/api/dist/maintenance/maintenance.cli.js emergencies
node apps/api/dist/maintenance/maintenance.cli.js backup-check
```

In dev: `pnpm --filter @wizer/api maintenance all`.

### Cron example

```cron
# Alerts + due reports + emergency auto-END every 5 minutes
*/5 * * * *  cd /opt/wizer-signage && node apps/api/dist/maintenance/maintenance.cli.js sweep   >> /var/log/ms-maint.log 2>&1
*/5 * * * *  cd /opt/wizer-signage && node apps/api/dist/maintenance/maintenance.cli.js reports >> /var/log/ms-maint.log 2>&1
*/5 * * * *  cd /opt/wizer-signage && node apps/api/dist/maintenance/maintenance.cli.js emergencies >> /var/log/ms-maint.log 2>&1
# Full nightly cleanup at 03:30
30 3 * * *   cd /opt/wizer-signage && node apps/api/dist/maintenance/maintenance.cli.js all     >> /var/log/ms-maint.log 2>&1
```

### Docker Compose worker

Run a sidecar that loops, or (recommended) use the host/cluster cron to `docker
compose exec api node dist/maintenance/maintenance.cli.js all`. Keep the worker on
the same image + env as the API. The CLI opens a Nest application context (no HTTP
server), runs the job, and exits.

## On-demand (Super Admin)

`POST /admin/maintenance/run` `{ "job": "all" | "sweep" | "retention" | "reports"
| "emergencies" | "backup-check" }` triggers a job immediately (Super Admin),
audit-logged as `retention.cleanup_run`.

## Phase 11 handoff

These jobs assume an external cron/worker. Phase 11 (deployment hardening) should
wire the cron schedule into the production Compose/Nginx setup and ship the
maintenance worker alongside the API image.
