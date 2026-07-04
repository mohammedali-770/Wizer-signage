# Staging Deployment & Verification Runbook

A practical, copy-pasteable runbook to deploy the **full Wizer Signage stack** to
a real VPS/staging server and verify it end-to-end **before go-live**. It assumes
the Phase 0–11 build and reuses the existing files (`infra/docker/*`, `scripts/*`,
`docs/*`). Run everything as a **sudo-capable non-root user**.

> Conventions used below:
>
> ```bash
> export STACK=/opt/wizer-signage
> export DC="docker compose -f infra/docker/docker-compose.yml"   # run from $STACK
> export APP_DOMAIN="staging.example.com"                          # your staging domain
> ```
>
> Most app config comes from the repo-root `.env` (the compose reads `../../.env`).

---

## 0. Known deployment caveats & smallest safe fixes (read first)

| #   | Caveat                                                                                                                                                                              | Smallest safe fix                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Nginx won't start on first boot** — the `:443` block references a cert that doesn't exist yet (`[emerg] cannot load certificate`), which also blocks the ACME challenge on `:80`. | Seed a **self-signed placeholder** cert before the first `up` (§7, also in [nginx-ssl.md](./nginx-ssl.md)). No code change.    |
| 2   | **`pg_dump` version skew** — the maintenance image's `postgresql-client` major must match the Supabase Postgres major (16) or `pg_dump` errors with _"server version mismatch"_.    | If it errors, pin the client in `infra/docker/Dockerfile.maintenance`: replace `postgresql-client` with `postgresql16-client`. |
| 3   | **`NEXT_PUBLIC_API_URL` is build-time** — it's inlined into the dashboard bundle; changing the domain requires **rebuilding** the dashboard image.                                  | Set it in `.env` **before** `build`; rebuild `dashboard` if the domain changes.                                                |
| 4   | **Migrations are not auto-run** (by design — no unattended destructive commands).                                                                                                   | Run the explicit one-shot in §6.                                                                                               |
| 5   | **Seed uses `ts-node`** (a dev dependency, not in the production image).                                                                                                            | Seed from the cloned repo with dev deps (§6), not the API container.                                                           |
| 6   | The dashboard is **client-only** (no SSR API calls), so the container `API_URL` is unused at runtime — only `NEXT_PUBLIC_API_URL` matters.                                          | None — informational.                                                                                                          |

This runbook is for **staging**. Use **Let's Encrypt `--staging`** certs and a
disposable Supabase project; never point staging at production data.

---

## 1. Server preparation

**Sizing (staging):** Ubuntu 22.04/24.04 LTS, **2 vCPU / 4 GB RAM / 40 GB SSD**
minimum (the compose limits total ~3 vCPU / 1.6 GB; 4 vCPU / 8 GB is comfortable
for the E2E + a light load test). Public IPv4. No local database (Supabase is
external).

```bash
# Base packages + firewall
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y ca-certificates curl git ufw

# Docker Engine + Compose plugin (official convenience script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"      # log out/in for this to take effect
docker --version && docker compose version

# Firewall: allow SSH + HTTP + HTTPS ONLY
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw --force enable
sudo ufw status verbose
```

**Required open ports:** **22** (SSH, ideally restricted to your IP), **80** +
**443** (public). The API (3001) and dashboard (3000) are `expose`-only on the
internal Docker network and **must never** be reachable from the internet.

**DNS:** add an **A/AAAA** record for `$APP_DOMAIN` → the server's public IP.
Verify before issuing TLS: `dig +short $APP_DOMAIN` (must return your server IP).

**Folder structure:**

```bash
sudo mkdir -p /opt/wizer-signage && sudo chown "$USER":"$USER" /opt/wizer-signage
cd /opt/wizer-signage          # = $STACK; deploy here
```

---

## 2. Repository deployment

```bash
cd "$STACK"
git clone <your-repo-url> .
git fetch --tags
git checkout <release-tag>       # pin a tag, e.g. v1.0.0 (not a moving branch)

# Production env from the template
cp infra/docker/.env.production.example .env
chmod 600 .env                   # owner-only; never world-readable, never committed
nano .env                        # fill in (see checklist below)
```

**Required env checklist** (the API fails fast at boot if a `[REQUIRED]` is missing):

- Core: `NODE_ENV=production`, `APP_DOMAIN`, `DASHBOARD_URL`, `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS`
- Database **[REQUIRED]**: `DATABASE_URL`, `DIRECT_URL`
- Auth **[REQUIRED]**: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` (≥16 chars; use 48+)
- Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_STORAGE_BUCKET`
- SMTP (optional but recommended): `SMTP_HOST/PORT/USER/PASSWORD/FROM/SECURE`
- Maintenance/backup: `RETENTION_DAYS`, `CONTENT_TRASH_RETENTION_DAYS`, `BACKUP_DIR=/backups`, `TZ`
- SSL: `LETSENCRYPT_EMAIL`

**Secret generation:**

```bash
for k in JWT_ACCESS_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY; do
  echo "$k=$(openssl rand -base64 48)";
done
# paste the output into .env (replace the placeholders)
```

> Lock `CORS_ORIGINS` to your dashboard origin (e.g. `https://staging.example.com`).
> Never leave it as `*` outside local dev.

---

## 3. Supabase preparation

1. Create a Supabase project (a **separate** one for staging).
2. **Connection strings** (Project → Settings → Database):
   - `DATABASE_URL` → the **pooled** (pgBouncer, port 6543) string + `?pgbouncer=true&sslmode=require` — used at runtime.
   - `DIRECT_URL` → the **direct** (port 5432) string + `?sslmode=require` — used by Prisma **migrations** (`migrate deploy`).
3. **Storage bucket:** Storage → New bucket → name it to match `SUPABASE_STORAGE_BUCKET` (e.g. `wizer-signage`) → **Private** (toggle "Public" OFF).
4. **Private bucket is required** — the app serves content only via **short-lived
   signed URLs** generated server-side; there are no public object URLs.
5. **Service role key safety:** `SUPABASE_SERVICE_ROLE_KEY` is **server-only** (API
   container env). It is never sent to the browser and never goes in `NEXT_PUBLIC_*`.
6. **RLS/storage assumptions:** the API accesses storage with the **service role**
   (full access) and enforces tenant isolation in application code (companyId
   from the JWT). You do **not** need to author Supabase RLS policies for the app
   to function; keep the bucket private and the anon key low-privilege.

Verify connectivity after the stack is up (§6 readiness probe returns
`database: up`).

---

## 4. SMTP setup

Variables: `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS / 465 TLS), `SMTP_USER`,
`SMTP_PASSWORD` (or `SMTP_PASS`), `SMTP_FROM`, `SMTP_SECURE` (`true` forces TLS).

**Test email sending** (after the stack is up): trigger a real email and check the
delivery log.

```bash
# Easiest: invite a user from the dashboard (Company → Users → Invite) and confirm
# the invite email arrives. Then check the audit row:
cd "$STACK" && $DC exec api node -e "1" >/dev/null   # (ensure api is up)
# Inspect EmailDeliveryLog via the readiness flag + the dashboard:
curl -fsS "https://$APP_DOMAIN/api/health/ready" | grep -o '"mailConfigured":[a-z]*'
```

A successful send is recorded in **`EmailDeliveryLog`** (`status: SENT` +
`providerMessageId`); a failure is recorded as `FAILED` and **never breaks** the
originating action.

**If SMTP is not configured:** the API runs in **dev log-only mode** — emails are
logged, not sent (`mailConfigured: false`), and every send is still recorded in
`EmailDeliveryLog`. Alerts/invites/reports won't actually deliver until SMTP is set.

---

## 5. Docker verification

```bash
cd "$STACK"

# Validate the merged compose config (catches YAML/env errors early)
$DC config >/dev/null && echo "compose config OK"

# Build all images (dashboard bakes NEXT_PUBLIC_API_URL from .env)
$DC build

# (First boot only) seed the self-signed placeholder cert so nginx can boot on
# :443 before a real cert exists (see §7). Safe to re-run; won't clobber a real cert.
scripts/bootstrap-self-signed-cert.sh "$APP_DOMAIN"
$DC up -d

# Status + health
$DC ps                                   # all services "running"/"healthy"
$DC logs -f api                          # Ctrl-C to stop following
$DC logs --since=2m maintenance          # cron worker
```

**Healthcheck verification:** `docker inspect --format '{{.State.Health.Status}}'
wizer-signage-api` should report `healthy` (also dashboard + maintenance).

**Restart services safely:**

```bash
$DC restart api                          # one service
$DC up -d                                # apply config changes (recreates changed)
$DC down                                 # stop ALL (keeps volumes/certs/backups)
# NEVER: $DC down -v  (deletes volumes → destroys certs + backups)
```

---

## 6. Database migration & seed

```bash
cd "$STACK"

# 1) Apply migrations (prisma + schema ship in the API image; uses DIRECT_URL):
$DC run --rm api npx prisma migrate deploy

# 2) FIRST deploy only — create the initial Super Admin + Starter plan/demo.
#    The seed uses ts-node (dev dep, NOT in the prod image) → run from the repo:
#    set SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD in .env first.
#    (Requires Node 20 + pnpm on the host.)
corepack enable && corepack prepare pnpm@9 --activate
pnpm install
set -a; source .env; set +a
pnpm --filter @wizer/api db:seed
```

**Secrets safety:** when you **set `SEED_SUPERADMIN_PASSWORD`** (as instructed),
the seed prints only the admin **email + a "change me" reminder** — it does **not**
echo the password or any production key. ⚠️ If you leave it **unset**, the seed
falls back to a **well-known default password and prints it** — so always set
`SEED_SUPERADMIN_PASSWORD` (and `SEED_COMPANYADMIN_PASSWORD`) on a real server.

**First login & password change:** open `https://$APP_DOMAIN`, log in as the
seeded Super Admin, complete 2FA enrolment (§9), then **change the password
immediately** (top-right → account / settings). Remove `SEED_SUPERADMIN_PASSWORD`
from `.env` afterward.

---

## 7. Nginx & SSL

**Configure the domain:** just set `APP_DOMAIN` in the repo-root `.env` (e.g.
`wizer.sa`). The nginx service renders its server blocks from
`infra/nginx/templates/wizer-signage.conf.template` via `envsubst` at startup —
no config file to hand-edit, and no domain is hardcoded. See
[nginx-ssl.md](./nginx-ssl.md).

**Certbot flow (host certbot, staging first):**

```bash
# 1) Self-signed placeholder so nginx can boot (else :443 fails to start).
#    The helper reads the cert volume name from compose, is safe to re-run, and
#    will NOT overwrite a real certificate (unless you pass --force).
scripts/bootstrap-self-signed-cert.sh "$APP_DOMAIN"
$DC up -d                                # nginx now boots on :80 + :443

sudo apt-get install -y certbot

# 2) STAGING test issuance (avoids Let's Encrypt rate limits):
sudo certbot certonly --webroot \
  -w /var/lib/docker/volumes/wizer-signage-certbot-webroot/_data \
  -d "$APP_DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email --staging

# 3) PRODUCTION issuance once staging works (replaces the placeholder):
sudo certbot certonly --webroot \
  -w /var/lib/docker/volumes/wizer-signage-certbot-webroot/_data \
  -d "$APP_DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email --force-renewal

# 4) Sync the host-issued cert into the Docker volume nginx reads, then reload.
#    (Host certbot writes to /etc/letsencrypt/live/$APP_DOMAIN/, but nginx reads
#    the wizer-signage-letsencrypt volume — they are different locations.)
sudo APP_DOMAIN="$APP_DOMAIN" scripts/sync-letsencrypt-to-docker.sh
```

**Renewal test:** `sudo certbot renew --dry-run`. Install the sync helper as a
deploy hook so renewals auto-copy into the volume and reload nginx:

```bash
sudo install -m 0755 scripts/sync-letsencrypt-to-docker.sh \
  /etc/letsencrypt/renewal-hooks/deploy/wizer-signage-sync-docker-nginx.sh
```

See [nginx-ssl.md](./nginx-ssl.md) for details.

**Verify:**

```bash
curl -fsSI "https://$APP_DOMAIN/" | head -1                  # HTTPS 200 (dashboard)
curl -fsS  "https://$APP_DOMAIN/api/health" | grep -o '"status":"ok"'   # /api routing
curl -fsSI "http://$APP_DOMAIN/" | grep -i location          # 301 → https
curl -fsSI "https://$APP_DOMAIN/" | grep -i strict-transport-security   # HSTS present
```

- **`/api` routing:** the `/api/health` check above proves it.
- **`/ws` upgrade:** WebSocket is reserved for future use (Phase 8 commands use
  polling). The location + `$connection_upgrade` map are present; nothing to
  exercise functionally yet.
- **Large upload path:** confirmed by uploading a large video in §9 (nginx allows
  512 MB with streamed `proxy_request_buffering off`).

**Troubleshooting:** if `$DC ps` shows **`nginx` `Restarting`** and `$DC logs nginx`
shows **`[emerg] cannot load certificate`**, the cert files are missing — run the
bootstrap helper, then start nginx:

```bash
scripts/bootstrap-self-signed-cert.sh "$APP_DOMAIN"
$DC up -d nginx
```

Then issue/renew the real cert and reload nginx.

---

## 8. System health checks

```bash
curl -fsS "https://$APP_DOMAIN/api/health"        | jq      # liveness: status/version/uptime
curl -fsS "https://$APP_DOMAIN/api/health/ready"  | jq      # readiness: database up/down + flags
curl -fsSI "https://$APP_DOMAIN/" | head -1                 # dashboard responds (200)
docker inspect --format '{{.State.Health.Status}}' wizer-signage-maintenance   # healthy (crond up)
```

- `/api/health/ready` returns **503** if the DB is unreachable, and exposes only
  booleans (`database`, `storageConfigured`, `mailConfigured`) — **no secrets**.
- **Logs to review:** `$DC logs api dashboard nginx maintenance`. The maintenance
  log should show cron entries firing on schedule.

---

## 9. End-to-end product test (UI + spot API checks)

Work through the full flow in the dashboard (`https://$APP_DOMAIN`):

| Step                         | Action                                                                 | Expected                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Super Admin login            | log in with the seeded credentials                                     | redirected to `/admin`                                                                         |
| **2FA enrolment**            | scan the TOTP QR, enter the code                                       | enrolment completes (mandatory for Super Admin)                                                |
| Create plan                  | Admin → Plans → New                                                    | plan listed                                                                                    |
| Create company               | Admin → Companies → New (assign the plan)                              | company created                                                                                |
| Create Company Admin         | invite a user with role COMPANY_ADMIN                                  | invite email sent (or logged)                                                                  |
| Company Admin login          | accept invite, log in                                                  | redirected to `/company`                                                                       |
| Create location              | Company → Locations → New                                              | location listed                                                                                |
| Create screen                | Company → Screens → New (assign location)                              | screen `UNPAIRED`                                                                              |
| **Pair Android TV**          | open the app → it shows a pairing code → claim it on the screen detail | screen → `PAIRING`/`ONLINE`                                                                    |
| Upload content               | Content Library → upload an **image, a video, and a PDF**              | content `ACTIVE` (type detected by magic bytes)                                                |
| Create playlist              | Playlists → New → add the items                                        | playlist valid                                                                                 |
| Create schedule              | Schedules → New → target the screen                                    | schedule `ACTIVE`                                                                              |
| **Playback manifest**        | screen detail → "preview what plays now"                               | `sourceType: SCHEDULE` + items with signed URLs                                                |
| **Android playback**         | watch the TV                                                           | the scheduled content loops                                                                    |
| **Offline cache**            | (see §10) disconnect the TV's network                                  | cached file content keeps playing; URL content is skipped                                      |
| Heartbeat                    | Monitoring page                                                        | screen `ONLINE`, recent heartbeat                                                              |
| Screenshot                   | screen detail → Take screenshot                                        | image appears (own-window only; video may be black — a limitation, not a bug)                  |
| **Remote: Force sync**       | screen detail → Force sync                                             | command issued → device acks → status `SUCCEEDED`                                              |
| **Proof-of-play**            | Reports → Proof of Play                                                | `ITEM_STARTED/COMPLETED` rows after playback                                                   |
| **Emergency broadcast**      | Emergency → Quick text → target the screen → Activate                  | TV pre-empts the schedule within a refresh cycle; manifest `sourceType: EMERGENCY`             |
| **End emergency**            | Emergency → End                                                        | TV returns to the normal schedule; the interrupted item logs `ITEM_INTERRUPTED`                |
| Notifications/alerts         | bell + Alerts page                                                     | emergency/offline/etc. alerts appear; acknowledge/resolve works                                |
| **Scheduled report run-now** | Reports → Scheduled → New (recipients) → Run now                       | delivery `SENT`; recipients get a signed link                                                  |
| **Exports**                  | Alerts/Monitoring → Export                                             | CSV + XLSX download; **PDF** downloads as a print-optimized **HTML** (the documented fallback) |
| **Maintenance job**          | `POST /admin/maintenance/run {"job":"all"}` (Super Admin)              | returns job result (see §13)                                                                   |
| **Backup record**            | `GET /admin/backups` after a backup                                    | a `SUCCESS` `BackupRecord` row                                                                 |

Spot-check the manifest via the API with a device token (copy it from the player
logs or DB during pairing):

```bash
curl -fsS -H "X-Device-Token: <DEVICE_TOKEN>" "https://$APP_DOMAIN/api/device/manifest" | jq '.sourceType, (.items|length)'
```

---

## 10. Android TV test

> The Android build is **not** runnable in CI (needs **JDK 17 + Android SDK** + a
> generated `gradle-wrapper.jar`). Build on a real machine / Android Studio.

```bash
# Configure the production API base URL (build-time) in the release buildType:
#   apps/android-tv-player/app/build.gradle.kts:
#   buildConfigField("String","API_BASE_URL","\"https://staging.example.com/api\"")

cd apps/android-tv-player
./gradlew :app:assembleDebug                  # debug APK (quick test)
# Release: ./gradlew :app:assembleRelease     # SIGN with your release keystore
#   (keystore kept OUT of source control; see docs/android-player.md)

# Install on the TV (enable developer mode + network/USB debugging):
adb connect <tv-ip>
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Test matrix:

- **Pair screen** — app shows a code → claim it in the dashboard.
- **Content playback** — image/video/PDF/text loop per the schedule.
- **Internet disconnect** — cached file content keeps playing (offline last-good
  manifest); reconnect resumes fresh sync.
- **App restart** — relaunches and resumes playback (token persists, encrypted).
- **Token revocation / unpair** — Unpair the screen in the dashboard (or remote
  `UNPAIR_DEVICE`) → the app detects 401 → clears pairing → shows the pairing code.

**Known limitations (by design — verify, don't treat as bugs):**

- ❌ No kiosk mode yet · ❌ No auto-start on boot yet · ❌ No in-app APK auto-update yet
- ⚠️ **URL content is not cached** → skipped while offline
- ⚠️ **Screenshots** capture the app's own window only (video on a secure surface
  may be black; API < 26 unsupported) — never fabricated

---

## 11. Security verification

```bash
# Swagger DISABLED in production:
curl -fsS -o /dev/null -w "%{http_code}\n" "https://$APP_DOMAIN/api/docs"     # expect 404

# CORS locked to the production domain (a foreign origin must NOT be allowed):
curl -fsS -H "Origin: https://evil.example" -I "https://$APP_DOMAIN/api/health" | grep -i access-control-allow-origin || echo "no ACAO for foreign origin (good)"

# Internal services not exposed (from the public internet these must fail/refuse):
curl -m5 "http://$APP_DOMAIN:3001/api/health" ; echo "(should NOT connect)"
curl -m5 "http://$APP_DOMAIN:3000/" ;          echo "(should NOT connect)"

# nginx security headers present:
curl -fsSI "https://$APP_DOMAIN/" | grep -iE "strict-transport-security|x-content-type-options|x-frame-options|referrer-policy|permissions-policy"
```

Manual / cross-checks:

- [ ] **Supabase service key not in the frontend** — `view-source` / search the
      dashboard bundle for the key string → must be absent (only `NEXT_PUBLIC_*` ship).
- [ ] **Storage URLs are signed/private** — content URLs are short-lived signed
      URLs; the bucket is private (direct object URL → 403/expired).
- [ ] **Device token can't reach dashboard APIs** —
      `curl -H "X-Device-Token: <t>" https://$APP_DOMAIN/api/monitoring/overview` → **401/403**.
- [ ] **Company A cannot see Company B** — as a Company-A admin, requesting a
      Company-B screen id returns **404** (tenant isolation).
- [ ] **Viewer cannot issue commands** — a Viewer hitting a `screen:command` /
      `emergency:send` action → **403**.
- [ ] **Super Admin 2FA required** — a Super Admin without TOTP is forced to enrol.
- [ ] **Upload magic-byte validation active** — rename a `.txt` to `.png` and
      upload → rejected (type detected from bytes, not the extension).

Run a dependency audit and record findings:

```bash
pnpm audit --prod        # NOTE: Next.js 14.2.x advisories are known + documented
                         # (patched in 15.x; upgrade is a separate task) — see
                         # docs/security-hardening.md
```

---

## 12. Backup & restore test

```bash
cd "$STACK"

# Run a backup manually inside the maintenance worker:
$DC exec maintenance bash scripts/backup-db.sh

# Confirm the BackupRecord (Super Admin):
curl -fsS "https://$APP_DOMAIN/api/admin/backups" -H "Authorization: Bearer <SA_JWT>" | jq '.recent[0]'

# Confirm the backup FILE exists in the volume:
$DC exec maintenance ls -lh /backups
```

**Restore dry-run** (document; do **not** restore over a live DB without a plan —
see [backup-restore.md](./backup-restore.md)). Example against a **scratch**
database:

```bash
gunzip -c /var/lib/docker/volumes/wizer-signage-backups/_data/wizer-signage_*.sql.gz \
  | psql "$DIRECT_URL_SCRATCH"     # a disposable DB, NEVER the live one
```

- **Financial records not affected by retention:** run retention (§13) and confirm
  `Invoice` / `Subscription` rows are **untouched** (only telemetry/operational
  data is pruned; the retention service has no code path that deletes them).
- **Backup-failure alert (safe simulation):** temporarily set an invalid
  `DATABASE_URL` for a single manual run (`-e DATABASE_URL=postgres://bad`) →
  `pg_dump` fails → a **system `backup.failed` alert** appears for Super Admins.
  Restore the correct value immediately after. _(Or simulate via
  `record-backup --status=FAILED`.)_

---

## 13. Maintenance cron test

```bash
cd "$STACK"

# Run each job once and read the JSON result:
$DC exec maintenance node dist/maintenance/maintenance.cli.js sweep
$DC exec maintenance node dist/maintenance/maintenance.cli.js retention
$DC exec maintenance node dist/maintenance/maintenance.cli.js reports
$DC exec maintenance node dist/maintenance/maintenance.cli.js emergencies
$DC exec maintenance node dist/maintenance/maintenance.cli.js backup-check
$DC exec maintenance node dist/maintenance/maintenance.cli.js all          # everything

# Or trigger via the API (Super Admin):
curl -fsS -X POST "https://$APP_DOMAIN/api/admin/maintenance/run" \
  -H "Authorization: Bearer <SA_JWT>" -H "Content-Type: application/json" \
  -d '{"job":"all"}' | jq
```

Confirm:

- **alerts sweep** — offline/subscription/storage/content alerts raised + auto-resolved.
- **retention cleanup** — counts returned; **financial records untouched**.
- **scheduled reports** — due reports ran (delivery rows).
- **emergency auto-END** — broadcasts past `endAt` ended + screens refreshed.
- **backup health check** — `backupStale` flag; overdue raises an alert.
- **Logs** — `$DC logs --since=10m maintenance` shows the cron firing.
- **No duplicate/destructive behaviour** — jobs are **idempotent** (deduped
  alerts, `deleteMany` retention, status-gated auto-END); re-running is safe.

---

## 14. Load / smoke test

> Run from a **separate** machine, against **staging only**. One IP will hit the
> API's 100 req/min throttle — raise it or exempt the test IP deliberately; don't
> disable throttling globally. See [performance-testing.md](./performance-testing.md).

```bash
# Install k6, then:
k6 run -e BASE_URL="https://$APP_DOMAIN/api" scripts/load-test/smoke.js

# With auth (optional) — exercises monitoring overview + manifest + sync-plan:
k6 run -e BASE_URL="https://$APP_DOMAIN/api" -e TOKEN="<JWT>" -e DEVICE_TOKEN="<device>" \
       scripts/load-test/smoke.js
```

The script covers `health` + `health/ready` (always) and, when tokens are
supplied, `monitoring/overview`, `device/manifest`, and `device/sync-plan`. Extend
it with `http.post` for `device/heartbeat` and `device/proof-of-play/events` to
load the write paths.

**Metrics to capture:** `http_req_duration` **p95/p99** per endpoint,
`http_req_failed` rate (< 1%), api container CPU/RAM (`docker stats`), and watch
Supabase pooler connection saturation.

---

## 15. Failure / rollback test

```bash
cd "$STACK"

# Stop the API and observe graceful degradation:
$DC stop api
curl -fsSI "https://$APP_DOMAIN/" | head -1            # dashboard still serves (502/504 on /api calls)
curl -s   -o /dev/null -w "%{http_code}\n" "https://$APP_DOMAIN/api/health"   # 502/504 (nginx up, upstream down)
$DC start api                                          # recovers; healthcheck → healthy

# Rollback to a previous image/tag:
git fetch --tags && git checkout <previous-tag>
$DC build && $DC up -d                                 # rebuild from the older commit
# If the domain/NEXT_PUBLIC_API_URL changed, the dashboard rebuilds automatically here.

# Maintenance worker failure: a single job failure is logged + (for backups) alerts;
# crond keeps running and retries on the next tick (idempotent) — no manual recovery.
```

**Database restore caution:** Prisma migrations are **forward-only**. If a deploy's
migration must be undone, **restore the pre-deploy backup** (always take a fresh
backup _before_ a risky migrate) — see [backup-restore.md](./backup-restore.md).
Never edit an already-applied migration; write a new corrective one.

---

## 16. Final staging report template

Copy this table; one row per area. Sign off only when every **High** priority row
is **Pass** and "Ready for production?" is **Yes**.

| Area tested                                            | Pass/Fail | Evidence (log/screenshot/curl)        | Issue found | Fix required | Owner | Priority | Ready for prod? |
| ------------------------------------------------------ | --------- | ------------------------------------- | ----------- | ------------ | ----- | -------- | --------------- |
| 1. Server prep (Docker, firewall, DNS)                 |           | `ufw status`, `dig`                   |             |              |       | High     |                 |
| 2. Repo + env + secrets                                |           | `.env` perms `600`, secrets generated |             |              |       | High     |                 |
| 3. Supabase (DB + private bucket)                      |           | `ready` → `database: up`              |             |              |       | High     |                 |
| 4. SMTP (send + delivery log)                          |           | invite email + `EmailDeliveryLog`     |             |              |       | Med      |                 |
| 5. Docker (config/build/up/ps/health)                  |           | `$DC ps`, health = healthy            |             |              |       | High     |                 |
| 6. Migrations + seed + first login                     |           | `migrate deploy` ok, SA login         |             |              |       | High     |                 |
| 7. Nginx + SSL (cert, renew, HTTPS, /api)              |           | `curl -I https`, HSTS header          |             |              |       | High     |                 |
| 8. Health checks (live/ready/dashboard/maint)          |           | `/api/health(/ready)`                 |             |              |       | High     |                 |
| 9. E2E product flow                                    |           | per §9 table                          |             |              |       | High     |                 |
| 10. Android TV (pair/play/offline/restart/unpair)      |           | device + dashboard                    |             |              |       | High     |                 |
| 11. Security (swagger/CORS/isolation/RBAC/2FA/headers) |           | per §11                               |             |              |       | High     |                 |
| 12. Backup + restore + financial safety                |           | `BackupRecord`, file, dry-run         |             |              |       | High     |                 |
| 13. Maintenance cron (5 jobs + logs)                   |           | CLI JSON results                      |             |              |       | Med      |                 |
| 14. Load/smoke (k6 p95/error rate)                     |           | k6 summary                            |             |              |       | Med      |                 |
| 15. Failure/rollback                                   |           | stop/start, tag rollback              |             |              |       | Med      |                 |

**Go/No-Go:** Ready for production = **Yes** only if §3, §5, §6, §7, §8, §9, §11,
§12 are all **Pass**, no open High issue remains, and the dependency-audit findings
(Next.js advisories) are acknowledged with a follow-up plan.

---

## Related documentation

- [production-deployment.md](./production-deployment.md) — concise deploy runbook
- [docker-production.md](./docker-production.md) — images & compose
- [nginx-ssl.md](./nginx-ssl.md) — proxy + Let's Encrypt
- [environment-variables.md](./environment-variables.md) — every env var
- [security-hardening.md](./security-hardening.md) — security review + checklist
- [monitoring-operations.md](./monitoring-operations.md) — logs, health, ops
- [performance-testing.md](./performance-testing.md) — load-test foundation
- [data-retention.md](./data-retention.md) — maintenance cron + retention
- [backup-restore.md](./backup-restore.md) — backup & restore
- [android-player.md](./android-player.md) — APK build + production handoff
