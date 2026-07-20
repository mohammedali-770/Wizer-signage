# Backup & Restore Runbook

This runbook covers backing up and restoring **Wizer Signage** data. The platform's
database and object storage live in **Supabase (external)**, so this document combines
**Supabase managed backups** with our own **application-managed dumps** for defense in
depth.

> **Golden rule:** a backup you have never restored is not a backup. Test the restore
> procedure (Section 6) on a non-production target on a schedule.

---

## 1. What we back up

| Asset                               | Backed up by                        | Mechanism                                                       |
| ----------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| Postgres database (all tenant data) | Us **and** Supabase                 | `scripts/backup-db.sh` (`pg_dump`) + Supabase automated backups |
| Uploaded media / content files      | Supabase Storage (+ planned export) | Supabase Storage durability + planned scheduled export job      |
| Configuration / `.env`              | Operator                            | Stored in a secret manager / secure vault — **never** in git    |

The database connection used for dumps is **`DIRECT_URL`** — the non-pooled Supabase
connection string. `pg_dump`/`psql` cannot talk to the pooled Prisma `DATABASE_URL`, which
carries `pgbouncer=true` (and other Prisma-only params) and fails with
`invalid URI query parameter: "pgbouncer"`. So the backup/restore scripts **prefer
`DIRECT_URL`** and only fall back to `DATABASE_URL` when `DIRECT_URL` is unset — and in that
fallback they strip the Prisma/PgBouncer-only query params so a pooled URL is never handed
to `pg_dump` unchanged (see `scripts/lib/pg-url.sh`). The application `DATABASE_URL` is left
untouched for Prisma and the BackupRecord CLI. Set **both** `DATABASE_URL` and `DIRECT_URL`
in production. See [environment-variables.md](./environment-variables.md).

---

## 2. Backup strategy & schedule

- **Daily** logical Postgres dump via `scripts/backup-db.sh`, run from cron on the VPS.
- **Supabase managed backups** run independently on the Supabase project (point-in-time /
  daily depending on plan) — these are our second, off-box copy.
- **Retention (default): 90 days** of daily dumps. Older dumps are pruned automatically by
  the backup script.
- **Financial / invoice records are retained longer than the 90-day default** (multi-year,
  per accounting/legal requirements). These are preserved either through dedicated longer
  retention dumps or by never pruning the rows themselves; do **not** let the 90-day prune
  policy delete data needed for financial recordkeeping.

### Where dumps live

- Default local target: `/opt/wizer-signage/backups/db/` on the VPS (timestamped,
  compressed files, e.g. `wizer-signage-YYYYMMDD-HHMMSS.sql.gz`).
- **Strongly recommended:** sync these off-box (object storage / a separate host) so a lost
  VPS does not lose the backups. Keep the canonical location consistent with
  `scripts/backup-db.sh`.

### Cron example

Run a daily dump at 02:30 server time (use Git Bash/WSL semantics on Windows hosts; on the
Ubuntu VPS this is native):

```bash
# crontab -e
30 2 * * * cd /opt/wizer-signage && ./scripts/backup-db.sh >> /var/log/wizer-signage-backup.log 2>&1
```

`scripts/backup-db.sh` selects the dump URL (`DIRECT_URL` preferred, sanitized `DATABASE_URL`
fallback — see above), runs `pg_dump`, compresses the output to the backups directory, and
prunes dumps older than the retention window (keeping financial/invoice data per the longer
policy). It never prints connection URLs or credentials. A failed dump removes the partial
file and records a `FAILED` BackupRecord (raising a "backup overdue/failed" alert).

> **Containerized runs (`maintenance` service):** the nightly cron runs the backup as the
> unprivileged **node** user. A freshly-created `wizer-signage-backups` volume is owned
> `root:root`, so the container entrypoint (`infra/docker/maintenance-entrypoint.sh`) runs
> once as root at startup and `chown`s the `/backups` **mount point** (non-recursive) to
> `node` before `crond` starts — the jobs themselves never run as root. This is idempotent
> across restarts and never alters existing backup files.

---

## 3. Storage (files) backup policy

- Supabase Storage provides redundant, durable object storage as the primary protection for
  uploaded media.
- A **scheduled export of the Storage bucket** (`SUPABASE_STORAGE_BUCKET`) to off-box object
  storage is **planned** so file content has an independent copy alongside the DB dumps.
- File backups should be kept in step with the DB retention policy so a restored database
  references media that still exists.

---

## 4. Backup observability (planned)

To make backup health visible and actionable:

- **Last backup status visible to Super Admin** — the most recent backup's timestamp and
  success/failure surfaced in the Super Admin area of the dashboard.
- **Backup-failure alerts** — automated notification (email via SMTP, and/or webhook; see
  [api-future.md](./api-future.md)) when a scheduled backup fails or is overdue.

These are designed-for in v1 and fully wired later; the underlying `scripts/backup-db.sh`
exit status is the source of truth in the meantime.

---

## 5. Restore overview

Restores are **destructive** — they overwrite the target database. The restore tooling is
`scripts/restore-db.sh`, which restores a chosen dump into the database referenced by
`DIRECT_URL`.

> ⚠️ **DANGER**
>
> - A restore **replaces** the current contents of the target database. Existing data not in
>   the dump will be lost.
> - **Never** point a restore at the production database unless you are intentionally
>   performing disaster recovery and have confirmed the target.
> - Always take a fresh dump of the current state **before** restoring, so you can roll back.
> - Prefer restoring into a **staging / scratch** database first to validate the dump.

---

## 6. Step-by-step restore procedure

1. **Announce / enter maintenance.** Stop writes to avoid corruption during restore. Stop
   the API (and dashboard) so nothing is writing:

   ```bash
   docker compose --env-file .env -f infra/docker/docker-compose.yml stop api dashboard
   ```

2. **Take a safety dump of the current state** (your rollback point):

   ```bash
   ./scripts/backup-db.sh
   ```

3. **Select the dump to restore.** List available backups and pick the timestamp:

   ```bash
   ls -lh /opt/wizer-signage/backups/db/
   ```

4. **Confirm the target.** Double-check `DIRECT_URL` points at the **intended** database
   (staging for a drill, production only for real DR). Print and verify the host:

   ```bash
   # sanity check the host/db without exposing the password unnecessarily
   echo "$DIRECT_URL" | sed -E 's#(://[^:]+):[^@]+@#\1:****@#'
   ```

5. **Run the restore:**

   ```bash
   ./scripts/restore-db.sh /opt/wizer-signage/backups/db/wizer-signage-YYYYMMDD-HHMMSS.sql.gz
   ```

   The script restores the dump into the `DIRECT_URL` database. Watch the output for errors.

6. **Verify integrity.** Spot-check critical tables (tenants, users, billing/invoices) and
   row counts against expectations before re-opening traffic.

7. **Restart services and health-check:**

   ```bash
   docker compose --env-file .env -f infra/docker/docker-compose.yml start api dashboard
   curl -fsS https://wizer.sa/api/health
   curl -fsS https://wizer.sa/api/health/ready
   ```

8. **Exit maintenance** once health checks pass and spot checks look correct.

### Rolling back a bad restore

If verification fails, restore the **safety dump** you took in step 2 using the same
`scripts/restore-db.sh` procedure, then investigate the source dump.

---

## 7. Disaster-recovery notes

- The fastest recovery path for a database-level incident may be **Supabase's own managed
  backups / point-in-time recovery**; our dumps are the portable, vendor-independent copy.
- Keep at least one copy of dumps **off the VPS** so a total host loss is survivable.
- Document and periodically rehearse the full DR flow (provision DB → restore dump → restore
  storage → redeploy stack → health check).

---

## Backup health in the dashboard (Phase 10)

Each backup run is recorded in the **`BackupRecord`** table so Super Admins can
see backup health at **/admin/backups** (last successful database backup, staleness,
recent runs). `scripts/backup-db.sh` records the run automatically after `pg_dump`
by calling the maintenance CLI:

```
node apps/api/dist/maintenance/maintenance.cli.js record-backup \
  --type=DATABASE --status=SUCCESS --location="$OUTFILE" --size="$SIZE_BYTES"
```

(The script does this for you — it needs the API built and `DATABASE_URL` in the
env.) A **FAILED** record, or no successful database backup within the staleness
window (default 2 days), raises a **system alert** for Super Admins (see
[notifications-alerts.md](./notifications-alerts.md)); the `backup-check` job
(part of the maintenance `all` run) re-evaluates staleness on each tick — see
[data-retention.md](./data-retention.md).

> Retention note: routine `*.sql.gz` snapshots are pruned after `RETENTION_DAYS`,
> but **financial records are never deleted by the application's retention jobs** —
> keep dedicated long-term/offsite copies.

## Related documentation

- [environment-variables.md](./environment-variables.md) — `DIRECT_URL`, Supabase settings
- [production-deployment.md](./production-deployment.md) — server & stack operations
- [database-schema.md](./database-schema.md) — what the data contains
- [security.md](./security.md) — handling backup secrets and access
- [api-future.md](./api-future.md) — webhook events used for backup alerts
