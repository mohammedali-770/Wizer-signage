# Backup & Restore Runbook

This runbook covers backing up and restoring **Wizer Signage** data. The platform's
database and object storage live in **Supabase (external)**, so this document combines
**Supabase managed backups** with our own **application-managed dumps** for defense in
depth.

> **Golden rule:** a backup you have never restored is not a backup. Test the restore
> procedure (Section 6) on a non-production target on a schedule.
>
> This is **automated**: `scripts/tests/backup-restore-drill.sh` (Docker required) seeds a
> throwaway Postgres, dumps it with the real `backup-db.sh`, mutates and corrupts the data,
> restores with the real `restore-db.sh` **into the now-non-empty database**, and asserts
> the rows came back. It is a regression test for a real defect: `pg_dump` previously ran
> without `--clean --if-exists`, so a restore into an existing schema aborted on its first
> statement — the exact disaster-recovery case the tooling exists for.
>
> That same case broke a second time when telemetry partitioning landed, in a new way the
> generic drill could not see because it seeds only non-partitioned tables. Restoring over an
> existing **migrated** schema is now covered by
> `scripts/tests/telemetry-backup-restore-drill.sh`, which restores the dump twice.

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
- **Snapshot retention (default): 14 days** of dumps — `BACKUP_RETENTION_DAYS`, falling
  back to `RETENTION_DAYS`. Older `*.sql.gz` files are pruned automatically by the backup
  script. (This is the _file_ retention window; it is independent of the database
  retention window that prunes telemetry rows.)
- **Financial / invoice records are retained far longer than any snapshot window**
  (multi-year, per accounting/legal requirements). They are preserved by never pruning the
  rows themselves — retention has no code path that touches invoices or subscriptions, and
  the `companies -> invoices/subscriptions/proof_of_plays` foreign keys are `ON DELETE
RESTRICT` so even a direct `DELETE FROM companies` cannot cascade them away. Do **not**
  rely on the pruned snapshots for financial archival — keep dedicated long-term copies.

### Where dumps live

- Written to `BACKUP_DIR` (default `<repo>/backups`; the maintenance container mounts the
  `wizer-signage-backups` volume at **`/backups`**, which is where production dumps live).
  Filenames are `wizer-signage_YYYYMMDD_HHMMSS.sql.gz` — note the **underscores**.
- **Offsite copy — set `BACKUP_OFFSITE_CMD`.** A dump that only exists on the machine it
  backs up is not a backup: losing the droplet, or one `docker compose down -v`, destroys
  the application and every recovery point in the same event. The script runs the command
  with the dump path as `$1` **before** pruning, and a failed upload fails the run and
  records a FAILED `BackupRecord`:

  ```bash
  BACKUP_OFFSITE_CMD='rclone copyto "$1" "remote:wizer-backups/$(basename "$1")"'
  ```

  When it is unset the script warns loudly on every run.

- **The PostgreSQL client major must match the server major.** `pg_dump` 17+ writes
  `SET transaction_timeout = 0;` into the dump preamble, which PostgreSQL 16 and older
  reject — and `restore-db.sh` pipes dumps into `psql --set ON_ERROR_STOP=on`, so the
  restore aborts on the preamble **before a single row is applied**. The failure is
  invisible until you try to recover: the nightly backup succeeds, the file is the right
  size, and it is simply not restorable. The maintenance image therefore pins
  `postgresql16-client` rather than the unversioned `postgresql-client`, which is a virtual
  package that floats to whatever major Alpine ships newest. The host needs the same major,
  since it runs `backup-db.sh` at deploy time; production preflight compares the two.
  **On a server upgrade, change `infra/docker/Dockerfile.maintenance` and the host package
  together** — `maintenance-runtime.spec.ts` pins the image against CI's Postgres service
  so the pair cannot drift silently.

- **The command must exist in BOTH places that run it.** `backup-db.sh` executes on the
  **host** at deploy time (`deploy-blue-green.sh`) and inside the **maintenance container**
  on the nightly cron schedule (`infra/docker/crontab`). Only `rclone` is installed in the
  maintenance image — `aws`, `curl`, `scp`, `ssh` and `rsync` are **not** there, so a
  command naming one of them works when you test it by hand on the host and then exits 127
  every night in the container. Production preflight resolves the command's first word
  inside the maintenance image for exactly this reason.

- **Verify the copy — set `BACKUP_OFFSITE_VERIFY_CMD`.** A zero exit from the copy command
  is not evidence that any bytes arrived. The verify command receives the same dump path as
  `$1` and must print the **remote** object's size in bytes as the first token of stdout;
  `backup-db.sh` compares it against the local dump and fails the run on any mismatch, so
  the check does not depend on the copying tool's own success claim:

  ```bash
  BACKUP_OFFSITE_VERIFY_CMD='rclone size --json "remote:wizer-backups/$(basename "$1")" | sed -n "s/.*\"bytes\":\([0-9]*\).*/\1/p"'
  ```

  This exists because the failure it catches is silent. Busybox `wget --post-file` — for a
  long time the only transfer tool present in the maintenance image — truncates binary
  payloads at the first NUL byte and still exits 0. A gzip dump begins `1f 8b 08 00`, so
  every "successful" upload was a 3-byte stub: the run logged `Offsite copy OK`, pinged the
  dead-man switch, and pruned older local backups. Nothing surfaced until a restore.
  Production preflight requires this variable.

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

## 4. Backup observability

Implemented. Backup health is visible and actionable:

- **Last backup status visible to Super Admin** — the most recent backup's timestamp and
  success/failure surfaced in the Super Admin area of the dashboard.
- **Backup-failure alerts** — automated notification (email via SMTP, and/or webhook; see
  [api-future.md](./api-future.md)) when a scheduled backup fails or is overdue.

Both are wired. `scripts/backup-db.sh` records each run as a `BackupRecord`; a FAILED
record raises a `backup.failed` alert and a missing recent success raises
`backup.overdue`, both at CRITICAL severity, so an unacknowledged "backups have
stopped" condition keeps re-notifying rather than scrolling away.

---

## 5. Restore overview

Restores are **destructive** — they overwrite the target database. The restore tooling is
`scripts/restore-db.sh`, which restores a chosen dump into the database referenced by
`DIRECT_URL`.

### How the restore is applied

The dump is **not** applied on top of the live schema. `restore-db.sh`:

1. renames the Wizer-owned schemas aside to `wizer_pre_restore_<timestamp>_public` and
   `wizer_pre_restore_<timestamp>_telemetry`, both in one transaction;
2. restores the dump into the names it has just freed, which is always the empty-target case;
3. checks tables actually exist afterwards;
4. **retains** the archived copy, printing the `DROP SCHEMA` to run once you are satisfied.
   Set `RESTORE_DROP_ARCHIVE=1` to drop it automatically.

If any step fails the script puts the archived schemas back and exits non-zero, so a failed
restore leaves you with the database you started with.

This is not incidental. Applying a dump over an existing migrated schema **does not work at
all**: since telemetry partitioning, `pg_dump --clean --if-exists` emits a `DROP CONSTRAINT`
for each monthly child partition's primary key, and PostgreSQL refuses to drop a constraint
inherited from the parent (`cannot drop inherited constraint`). The restore aborted partway
through the preamble — by which point every foreign key in the database had already been
dropped, leaving the target neither intact nor restored.

Restoring into a fresh _database_ would be the more usual form of this, but production is
managed Postgres: the connection owns one database it cannot rename and cannot detach the
platform's own sessions from. A schema rename needs only ownership, so it works on managed
and self-hosted targets alike.

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
   docker compose --env-file .env -f infra/docker/docker-compose.yml \
     exec maintenance ls -lh /backups
   ```

4. **Confirm the target.** Double-check `DIRECT_URL` points at the **intended** database
   (staging for a drill, production only for real DR). Print and verify the host:

   ```bash
   # sanity check the host/db without exposing the password unnecessarily
   echo "$DIRECT_URL" | sed -E 's#(://[^:]+):[^@]+@#\1:****@#'
   ```

5. **Run the restore:**

   ```bash
   ./scripts/restore-db.sh /backups/wizer-signage_YYYYMMDD_HHMMSS.sql.gz
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

If the restore itself fails, the script has already rolled back — the database is as it was,
and no action is needed beyond investigating the dump.

If the restore _succeeded_ but verification of the data fails, the pre-restore copy is still
present as `wizer_pre_restore_<timestamp>_*` unless you passed `RESTORE_DROP_ARCHIVE=1`.
That copy is the fastest way back and needs no dump file:

```sql
BEGIN;
DROP SCHEMA public CASCADE;
DROP SCHEMA wizer_telemetry CASCADE;
ALTER SCHEMA "wizer_pre_restore_<timestamp>_public"    RENAME TO public;
ALTER SCHEMA "wizer_pre_restore_<timestamp>_telemetry" RENAME TO wizer_telemetry;
COMMIT;
```

Otherwise restore the **safety dump** you took in step 2 using the same `scripts/restore-db.sh`
procedure, then investigate the source dump.

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
