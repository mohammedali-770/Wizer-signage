# Production Deployment Guide

This guide describes deploying **Wizer Signage** to a single **Ubuntu VPS** using
**Docker Compose**, **Nginx** (reverse proxy) and **Let's Encrypt** (TLS). There is **no
cPanel** and **no local database** — the database and object storage are provided by
**Supabase (external)**.

Target topology:

```
Internet ──HTTPS──> Nginx (infra/nginx) ─┬─ /      ──> dashboard:3000 (Next.js)
                                          ├─ /api   ──> api:3001 (NestJS)
                                          └─ <WS_PATH> (upgrade) ──> api:3001 (WebSocket)

                       api ──> Supabase (Postgres + Storage)  [external]
```

Compose services (see `infra/docker/docker-compose.yml`): **api** (build context
`./apps/api`), **dashboard** (build context `./apps/dashboard`), **nginx** (build context
`./infra/nginx`).

---

## 1. Server prerequisites

- Ubuntu 22.04 LTS (or newer) VPS with a public IPv4 address.
- A domain name you control (e.g. `wizer.sa`).
- Root or a sudo-capable non-root user (recommended; see hardening below).
- Open ports **80** and **443** in the cloud firewall / security group.

---

## 2. Install Docker & the Compose plugin

```bash
# Docker Engine + Compose plugin (official convenience script)
curl -fsSL https://get.docker.com | sh

# allow your non-root user to run docker
sudo usermod -aG docker "$USER"
newgrp docker

docker --version
docker compose version
```

---

## 3. Clone the repository

```bash
sudo mkdir -p /opt/wizer-signage
sudo chown "$USER":"$USER" /opt/wizer-signage
git clone <repository-url> /opt/wizer-signage
cd /opt/wizer-signage
```

---

## 4. Create the production `.env`

Copy the template and fill in **production** values:

```bash
cp .env.example .env
chmod 600 .env
```

> **Why every compose command below passes `--env-file .env`:** Docker Compose v2
> resolves `${VAR}` interpolation (e.g. nginx's `APP_DOMAIN`, the dashboard's
> `NEXT_PUBLIC_API_URL` build arg) from the **project directory** — the directory
> of the compose file (`infra/docker/`) — **not** your current working directory.
> Without the flag, a repo-root `.env` is silently ignored for interpolation:
> nginx refuses to start and the dashboard bakes in `http://localhost:3001/api`.
> (`scripts/deploy.sh` and `infra/Makefile` pass it automatically.)

Required production values (full reference: [environment-variables.md](./environment-variables.md)):

```dotenv
NODE_ENV=production
LOG_LEVEL=info

API_PORT=3001
DASHBOARD_PORT=3000
API_URL=http://api:3001
NEXT_PUBLIC_API_URL=https://wizer.sa/api
CORS_ORIGINS=https://wizer.sa
WS_PATH=/ws

# Supabase (external) — database & storage
DATABASE_URL=postgresql://postgres:password@db.<ref>.supabase.co:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres:password@db.<ref>.supabase.co:5432/postgres
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...           # secret — server only
SUPABASE_STORAGE_BUCKET=media

# Auth
JWT_ACCESS_SECRET=...                    # long random
JWT_REFRESH_SECRET=...                   # different long random
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=1209600
SESSION_INACTIVITY_TIMEOUT_MINUTES=30

# Email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=no-reply@wizer.sa
SMTP_PASSWORD=...                        # secret
SMTP_FROM=Wizer Signage <no-reply@wizer.sa>

# Map
MAP_PROVIDER=google
MAP_API_KEY=...
```

> **Note:** `API_URL` uses the **internal** Docker service name (`http://api:3001`) so the
> dashboard and Nginx reach the API over the Compose network. `NEXT_PUBLIC_API_URL` is the
> **public** browser URL and goes through Nginx (`https://wizer.sa/api`).
>
> **Fail-closed configuration (production):**
>
> - `NEXT_PUBLIC_API_URL` is **required at build time** and must be an absolute
>   HTTPS URL (no localhost, credentials, query, or fragment). Compose passes it
>   as the dashboard build arg; if it is unset the build stops immediately, and
>   `next.config.mjs` rejects invalid values. There is no localhost fallback in a
>   production build.
> - `CORS_ORIGINS` is **required** and must list HTTPS origins only. The API
>   refuses to start (non-zero exit) if it is missing, `*`, or contains a
>   non-HTTPS/localhost/malformed entry.
>
> Generate strong secrets: `openssl rand -base64 48`. Never commit `.env`.

---

## 5. DNS

Create an **A record** for your hostname pointing at the VPS public IP:

```
wizer.sa.   A   <VPS_PUBLIC_IP>
```

Wait for propagation (`dig +short wizer.sa` should return your IP) before requesting
certificates.

---

## 6. Obtain TLS certificates (Let's Encrypt, HTTP-01 / webroot)

The Nginx config has a `:443` block, so it needs a certificate file to **start at
all**. On a fresh server that cert doesn't exist yet, so seed a self-signed
placeholder first (so Nginx boots + serves the `:80` ACME challenge), then let
certbot issue the real cert. Full details in [nginx-ssl.md](./nginx-ssl.md).

1. **Seed a placeholder cert + bring up the stack.** The helper reads the cert
   volume name from compose, is safe to re-run, and won't overwrite a real cert:

   ```bash
   export APP_DOMAIN=wizer.sa
   scripts/bootstrap-self-signed-cert.sh "$APP_DOMAIN"
   docker compose --env-file .env -f infra/docker/docker-compose.yml up -d --build
   ```

2. **Request certificates via the certbot webroot plugin** (shares the ACME webroot volume
   with Nginx — use the `docker-compose.certbot.yml` override, or host certbot per
   [nginx-ssl.md](./nginx-ssl.md)):

   ```bash
   docker compose --env-file .env -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.certbot.yml \
     run --rm certbot certonly --webroot -w /var/www/certbot \
     -d "$APP_DOMAIN" --email ops@wizer.sa --agree-tos --no-eff-email --force-renewal
   ```

3. **Reload Nginx to pick up the real certificate.** The TLS server block
   (`listen 443 ssl;`, HTTP→HTTPS redirect, `/ws` upgrade) is already active — it
   was using the placeholder; certbot just replaced the cert files:

   ```bash
   docker compose --env-file .env -f infra/docker/docker-compose.yml exec nginx nginx -t \
     && docker compose --env-file .env -f infra/docker/docker-compose.yml exec nginx nginx -s reload
   ```

4. **Auto-renewal.** Certbot certs last 90 days. Run a periodic renewal (cron / systemd
   timer) that renews and reloads Nginx:

   ```bash
   # crontab -e  (renew daily; reload nginx if anything changed)
   0 3 * * * cd /opt/wizer-signage && docker compose --env-file .env -f infra/docker/docker-compose.yml run --rm certbot renew --webroot -w /var/www/certbot --quiet && docker compose --env-file .env -f infra/docker/docker-compose.yml exec nginx nginx -s reload
   ```

> Exact file names/volumes are defined in `infra/nginx/` and
> `infra/docker/docker-compose.yml`. Refer to those files for the authoritative paths.

---

## 7. Bring up the full stack

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml up -d --build
docker compose --env-file .env -f infra/docker/docker-compose.yml ps
```

---

## 8. Health checks

After the containers report healthy:

```bash
# direct internal check (the API port is NOT published in prod — check inside
# the container; the server binds 0.0.0.0, so 127.0.0.1 works).
docker compose --env-file .env -f infra/docker/docker-compose.yml exec api \
  wget -qO- http://127.0.0.1:3001/api/health

# through the public reverse proxy
curl -fsS https://$APP_DOMAIN/api/health
curl -fsS https://$APP_DOMAIN/api/health/ready
```

A healthy API returns:

```json
{ "status": "ok", "service": "...", "version": "...", "uptime": 0, "timestamp": "..." }
```

Open `https://wizer.sa/` to confirm the dashboard loads.

---

## 8b. Database migrations & seed (first deploy)

Migrations are **not** run automatically on container start (deliberately — no
destructive command runs unattended). Apply them explicitly as a one-shot:

```bash
# Build images first (so the API image with the schema + migrations exists):
docker compose --env-file .env -f infra/docker/docker-compose.yml build

# Apply Prisma migrations (uses DIRECT_URL). The prisma CLI + schema ship in the
# API image (prisma is a production dependency), so this runs in the container:
docker compose --env-file .env -f infra/docker/docker-compose.yml run --rm api npx prisma migrate deploy

# FIRST deploy only — create the initial Super Admin + a Starter plan/demo.
# The seed uses ts-node (a dev dependency, NOT in the production image), so run
# it from the cloned repo with dev deps installed, pointed at the prod DB:
#   pnpm install
#   SEED_SUPERADMIN_EMAIL=... SEED_SUPERADMIN_PASSWORD=... \
#   DATABASE_URL=... DIRECT_URL=... pnpm --filter @wizer/api db:seed
# >>> Change the seeded Super Admin password immediately after first login. <<<
```

## 8c. Maintenance worker & backups

The `maintenance` service runs the Phase 10 jobs on a schedule (busybox cron) —
alerts sweep + due scheduled reports + emergency auto-END every 5 min, a full
nightly run (incl. retention cleanup) at 03:30, and a `pg_dump` backup at 02:00
(written to the `wizer-signage-backups` volume, recorded at **/admin/backups**).

```bash
# Verify the worker is up and cron is firing:
docker compose --env-file .env -f infra/docker/docker-compose.yml logs -f maintenance

# Run a job on demand:
docker compose --env-file .env -f infra/docker/docker-compose.yml exec maintenance \
  node dist/maintenance/maintenance.cli.js all

# Manual backup now:
docker compose --env-file .env -f infra/docker/docker-compose.yml exec maintenance bash scripts/backup-db.sh
```

See [data-retention.md](./data-retention.md) and [backup-restore.md](./backup-restore.md).

## 8d. Go-live verification checklist

After the stack is up + TLS issued, confirm end-to-end:

- [ ] `curl -fsS https://$APP_DOMAIN/api/health` → `status: ok`
- [ ] `curl -fsS https://$APP_DOMAIN/api/health/ready` → `database: up`
- [ ] Dashboard loads at `https://$APP_DOMAIN` and you can **log in** (Super Admin).
- [ ] Create a company + Company Admin; log in as the Company Admin.
- [ ] Create a location + screen; **pair a test Android screen** (the player's
      `API_BASE_URL` must be `https://$APP_DOMAIN/api`).
- [ ] Upload content → build a playlist → schedule it → confirm the player shows
      it (and the **playback manifest** preview on the screen detail).
- [ ] Confirm a **heartbeat** appears under _Monitoring_ and **proof-of-play**
      events under _Reports_.
- [ ] Run maintenance once (`exec maintenance … all`) and a manual **backup**;
      confirm the backup shows at **/admin/backups**.
- [ ] Confirm the Swagger docs are **not** reachable at `/api/docs` in production.

---

## 9. Updating / rolling deploys

Use the deploy helper script (run from the repo root, in Git Bash/WSL on Windows):

```bash
./scripts/deploy.sh
```

A typical deploy does:

```bash
cd /opt/wizer-signage
git fetch --tags && git checkout <new-tag>        # pin a release tag
docker compose --env-file .env -f infra/docker/docker-compose.yml build
docker compose --env-file .env -f infra/docker/docker-compose.yml run --rm api npx prisma migrate deploy
docker compose --env-file .env -f infra/docker/docker-compose.yml up -d
docker image prune -f
```

> If you changed `APP_DOMAIN`/`NEXT_PUBLIC_API_URL`, rebuild the **dashboard**
> image (the public API URL is baked at build time).

### Rollback

1. **Stop / revert app:** check out the previous release tag and re-run
   `docker compose ... build && up -d` (images are rebuilt from that commit).
2. **Database:** Prisma migrations are forward-only. If a migration must be
   undone, **restore the most recent pre-deploy backup**
   (`scripts/restore-db.sh`, see [backup-restore.md](./backup-restore.md)) —
   always take a fresh backup _before_ applying migrations on a risky deploy.
3. **Verify** health + login again (§8d). Migration caution: never edit applied
   migrations; write a new corrective migration instead.

To stop everything: `docker compose --env-file .env -f infra/docker/docker-compose.yml down`
(add `-v` only if you intend to delete volumes — this destroys backups/certs).

---

## 10. Logs

```bash
# all services, follow
docker compose --env-file .env -f infra/docker/docker-compose.yml logs -f

# a single service
docker compose --env-file .env -f infra/docker/docker-compose.yml logs -f api
docker compose --env-file .env -f infra/docker/docker-compose.yml logs -f dashboard
docker compose --env-file .env -f infra/docker/docker-compose.yml logs -f nginx
```

Container logs are managed by the Docker logging driver; Nginx access/error logs are inside
the `nginx` container (and/or a mounted volume under `infra/nginx/`). Configure log
rotation via the Docker daemon (`/etc/docker/daemon.json`, `json-file` with `max-size` /
`max-file`).

---

## 11. Security hardening checklist

- [ ] **Firewall (UFW):** allow only `22`, `80`, `443`. `sudo ufw allow 22,80,443/tcp && sudo ufw enable`.
- [ ] **SSH:** key-only auth, disable password & root login (`PermitRootLogin no`, `PasswordAuthentication no`).
- [ ] **Non-root:** run deploys as a sudo user, not `root`; containers run as non-root where possible.
- [ ] **fail2ban:** install and enable for SSH brute-force protection (`sudo apt install fail2ban`).
- [ ] **Secrets:** `.env` is `chmod 600`, owned by the deploy user, never committed. Rotate `JWT_*`, `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_PASSWORD` on exposure.
- [ ] **Updates:** enable `unattended-upgrades`; keep Docker images current.
- [ ] **TLS:** HTTPS enforced, HTTP redirects to HTTPS, modern ciphers; certs auto-renew.
- [ ] **Supabase:** restrict DB network access, use the pooled `DATABASE_URL` for the app and `DIRECT_URL` only for migrations.
- [ ] **Backups:** schedule `scripts/backup-db.sh` (see [backup-restore.md](./backup-restore.md)) and verify restores.
- [ ] **CORS:** `CORS_ORIGINS` lists only your real front-end origin(s).

---

## Related documentation

- [docker-production.md](./docker-production.md) — images, compose, build/run
- [nginx-ssl.md](./nginx-ssl.md) — reverse proxy, security headers, Let's Encrypt
- [environment-variables.md](./environment-variables.md) — production env values
- [security-hardening.md](./security-hardening.md) — security review + checklist
- [monitoring-operations.md](./monitoring-operations.md) — logs, health, observability
- [performance-testing.md](./performance-testing.md) — load-test foundation
- [data-retention.md](./data-retention.md) — maintenance cron + retention policy
- [backup-restore.md](./backup-restore.md) — backup & restore runbook
- [architecture.md](./architecture.md) — system architecture
- [local-development.md](./local-development.md) — running locally
- [android-distribution.md](./android-distribution.md) — publish the TV player APK to this VPS over SSH (no Android SDK needed on the host; only sshd + sha256sum/mkdir/mv/flock)
