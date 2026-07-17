# Deploy runbook — WIZER rename + `wizer.sa` domain switch

One-time runbook that ships **two changes together** in a single maintenance window:

1. **The internal rename** (`master-signage*` → `wizer-signage*`) — this renamed the
   Docker images, containers, network, and volumes, so the currently-running
   `master-signage-*` containers must be removed before the new ones come up
   (otherwise they fight over ports 80/443).
2. **The domain switch** from the old host to **`wizer.sa`** — new public URLs baked
   into the dashboard bundle, and a fresh Let's Encrypt certificate for `wizer.sa`.

Run everything **on the deployment host** (the box that runs Docker), from the repo
root. Commands assume `bash`, `git`, `docker` (compose plugin), and `curl`.

> **Ordering matters.** nginx's `:443` server block hard-references
> `/etc/letsencrypt/live/${APP_DOMAIN}/fullchain.pem`. If you flip `APP_DOMAIN` to
> `wizer.sa` **before** that cert exists, nginx crash-loops. So: remove the old
> stack → issue the `wizer.sa` cert (port 80 is free) → then build + start the new
> stack. Follow the steps in order.

---

## 0. Pre-flight (do these first)

- [ ] **DNS**: point `wizer.sa` (and `www.wizer.sa` if you want it) at this host's
      public IP. Confirm it resolves **before** issuing the cert (HTTP-01 validates
      over the public name) — `dig +short wizer.sa` must return this host's IP.
- [ ] **DB snapshot** (safety). The database is external (Supabase); take a snapshot
      from the Supabase dashboard, or dump via the maintenance container if you use
      one. **No schema migration is required for this release** — the rename did not
      add Prisma migrations, and `DATABASE_URL` is left unchanged (see the note in
      step 2). `scripts/deploy.sh` still runs `prisma migrate deploy` (idempotent).
- [ ] **Maintenance heads-up**: expect ~2–5 min of downtime while the old stack is
      torn down and the new one is built/started.

---

## 1. Pull the renamed code

```bash
cd /path/to/wizer-signage          # the repo root on the host
git fetch --prune origin
git checkout main
git pull --ff-only origin main
```

This brings in the new compose names (`wizer-signage/*`), the renamed nginx template
(`infra/nginx/templates/wizer-signage.conf.template`), and the Android/app renames.

---

## 2. Update the server `.env` (domain values)

Edit the repo-root `.env` **on the host** (this file is not in git). Change the
domain/URL values from the old host to `wizer.sa`:

| Variable                    | New value              | Notes                                               |
| --------------------------- | ---------------------- | --------------------------------------------------- |
| `APP_DOMAIN`                | `wizer.sa`             | nginx `server_name` + TLS cert path                 |
| `APP_URL`                   | `https://wizer.sa`     | email links (invites, resets)                       |
| `API_URL`                   | `https://wizer.sa`     | public API origin (prefix `/api` added by app)      |
| `NEXT_PUBLIC_API_URL`       | `https://wizer.sa/api` | **baked into the dashboard bundle** → needs rebuild |
| `NEXT_PUBLIC_SITE_URL`      | `https://wizer.sa`     | marketing site canonical URL                        |
| `NEXT_PUBLIC_DASHBOARD_URL` | `https://wizer.sa`     |                                                     |
| `NEXT_PUBLIC_APP_URL`       | `https://wizer.sa`     |                                                     |
| `CORS_ORIGINS`              | `https://wizer.sa`     | comma-separate if you keep additional origins       |

**Leave `DATABASE_URL` / `DIRECT_URL` unchanged.** The app is database-name-agnostic;
the rename only updated `.env.example` (for fresh setups) to `wizer_signage`. Renaming
the live database is optional and unrelated to this deploy — see the appendix.

> `scripts/deploy.sh` runs `docker compose` from the repo root, so Compose reads this
> `.env` for both the `NEXT_PUBLIC_API_URL` **build arg** (baked at image build) and
> the runtime `env_file`. Rebuilding in step 4 is what actually bakes the new API URL
> into the client bundle.

---

## 3. Remove the old `master-signage-*` stack

The old containers still hold ports 80/443 and have the old names, so Compose won't
replace them automatically. Remove them (and the now-unused old network):

```bash
# Stop + remove the old-named app containers.
docker rm -f master-signage-nginx master-signage-dashboard \
             master-signage-api master-signage-maintenance 2>/dev/null || true

# Remove the old bridge network (ignore "not found" / "in use" — it's fine).
docker network rm master-signage 2>/dev/null || true

# Confirm nothing is left holding :80 / :443.
docker ps --filter "name=master-signage"        # expect no rows
```

The old **volumes** (`master-signage-letsencrypt`, `-certbot-webroot`, `-backups`)
are left in place for now — harmless. Optional cleanup is in the appendix.

---

## 4. Issue the `wizer.sa` certificate, then build + start

Port 80 is now free, so issue the cert with certbot **standalone** straight into the
new `wizer-signage-letsencrypt` volume (the one the new nginx mounts):

```bash
docker run --rm -p 80:80 \
  -v wizer-signage-letsencrypt:/etc/letsencrypt \
  -v wizer-signage-certbot-webroot:/var/www/certbot \
  certbot/certbot certonly --standalone \
    -d wizer.sa \
    --email admin@wizer.sa \
    --agree-tos --no-eff-email -n
```

> Add `-d www.wizer.sa` too if DNS for `www` points here **and** you want nginx to
> serve it (you'd also add `www.wizer.sa` to `server_name` in the template).

Verify the cert landed:

```bash
docker run --rm -v wizer-signage-letsencrypt:/etc/letsencrypt \
  certbot/certbot certificates      # should list wizer.sa
```

Now build images, run migrations, and bring the new stack up — `deploy.sh` does all of
it and restarts nginx at the end (so it re-resolves upstreams and finds the new cert):

```bash
bash scripts/deploy.sh
```

`deploy.sh` = pull (no-op) → `compose build` (bakes `NEXT_PUBLIC_API_URL=https://wizer.sa/api`)
→ `prisma migrate deploy` → `compose up -d` → `restart nginx` → poll `/api/health`.

---

## 5. Verify

```bash
# TLS + dashboard (expect HTTP/2 200 and a valid wizer.sa cert)
curl -I https://wizer.sa

# API health through nginx (expect {"status":"ok","service":"wizer-signage-api",...})
curl -s https://wizer.sa/api/health

# Public plans (proves API ↔ DB)
curl -s https://wizer.sa/api/public/plans | head -c 200; echo

# Containers all healthy and NEW-named
docker compose --env-file .env -f infra/docker/docker-compose.yml ps
```

In a browser: load `https://wizer.sa` (marketing home), `https://wizer.sa/signage`
(product), `https://wizer.sa/login`, and confirm no mixed-content/CORS errors in the
console (the baked API URL should be `https://wizer.sa/api`).

---

## 6. Certificate auto-renewal

If you don't already have a renewal cron/timer on the host, add one. Renew against the
same volume and reload nginx on success:

```bash
# crontab -e  (runs twice daily; certbot only renews when near expiry)
0 3,15 * * * docker run --rm \
  -v wizer-signage-letsencrypt:/etc/letsencrypt \
  -v wizer-signage-certbot-webroot:/var/www/certbot \
  certbot/certbot renew --webroot -w /var/www/certbot --quiet \
  && docker compose --env-file /path/to/wizer-signage/.env -f /path/to/wizer-signage/infra/docker/docker-compose.yml restart nginx
```

(The running nginx serves `/.well-known/acme-challenge/` from the shared
`certbot-webroot` volume, so webroot renewal needs no downtime.) See
[docs/nginx-ssl.md](nginx-ssl.md) for the full certificate reference.

---

## Rollback

If the new stack is unhealthy and you must revert quickly:

```bash
git checkout <previous-good-commit>        # pre-rename commit
# restore the old .env domain values (old host), then:
docker rm -f wizer-signage-nginx wizer-signage-dashboard \
             wizer-signage-api wizer-signage-maintenance 2>/dev/null || true
bash scripts/deploy.sh                      # rebuilds the old-named stack
```

The old `master-signage-letsencrypt` volume still holds the previous domain's cert, so
the old stack comes back with working TLS. DNS may need to point back to the old host.

---

## Appendix — optional cleanup & DB rename

**Prune the old volumes** once you're confident the switch is good (this deletes the
old domain's cert and old backups — only do it after verifying):

```bash
docker volume rm master-signage-letsencrypt master-signage-certbot-webroot 2>/dev/null || true
# Keep master-signage-backups if you want the old pg_dump history; else remove it too.
```

**Rename the live database (optional, low value).** The DB name is invisible to end
users and the app doesn't care what it's called. If you still want it to read
`wizer_signage` to match `.env.example`, do it in a maintenance window:

```sql
-- Disconnect the app first (stop the api container), then, as a superuser:
ALTER DATABASE mastersignage RENAME TO wizer_signage;
```

Then update `DATABASE_URL` / `DIRECT_URL` in the server `.env` to the new name and
`docker compose ... up -d api`. On managed Supabase you cannot `ALTER DATABASE RENAME`;
use a dump/restore into a new project/database instead. **Recommended: skip this** —
it's pure cosmetics and adds risk.
