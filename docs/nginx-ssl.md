# Nginx & Let's Encrypt SSL (Phase 11)

Nginx (`infra/nginx/`) is the only publicly exposed service (ports 80/443). It
terminates TLS and reverse-proxies the dashboard and API; the API and dashboard
containers are never published directly.

## Routing

| Path                           | Upstream                                                     |
| ------------------------------ | ------------------------------------------------------------ |
| `/`                            | `dashboard:3000` (Next.js)                                   |
| `/_next/static/`               | `dashboard:3000` (cached, `immutable`, 1y)                   |
| `/api/`                        | `api:3001` (prefix preserved; 512 MB uploads, 300s timeouts) |
| `/ws`                          | `api:3001` (WebSocket upgrade; reserved for future use)      |
| `/.well-known/acme-challenge/` | certbot webroot                                              |

`infra/nginx/nginx.conf` sets gzip, `client_max_body_size 512m`,
`server_tokens off`, and the `$connection_upgrade` map. The server blocks are
rendered from `infra/nginx/templates/wizer-signage.conf.template` and add the
security headers: **HSTS**, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy` (the API also sends Helmet headers; nginx
adds the transport-level HSTS + a safety net).

## Setting the domain (APP_DOMAIN)

The domain is **never hardcoded** in the active config. The compose `nginx`
service mounts `infra/nginx/templates/` into `/etc/nginx/templates/`, and the
official nginx image runs `envsubst` on `*.template` at startup, writing the
rendered server blocks to `/etc/nginx/conf.d/`. You only set one variable:

```bash
# repo-root .env (see infra/docker/.env.production.example)
APP_DOMAIN=wizer.sa
```

The compose file wires this automatically:

```yaml
environment:
  APP_DOMAIN: ${APP_DOMAIN:?APP_DOMAIN must be set in .env (e.g. wizer.sa)}
  NGINX_ENVSUBST_FILTER: '^APP_DOMAIN$$' # only substitute APP_DOMAIN
```

`NGINX_ENVSUBST_FILTER` is mandatory — without it `envsubst` would also clobber
nginx runtime variables like `$host`. The `:?` guard means the stack refuses to
start (before recreating the container) if `APP_DOMAIN` is unset, rather than
rendering a broken empty `server_name`/cert path. `wizer.sa` now lives
only in docs/examples/templates — never in an active config file.

## DNS & firewall

1. Point an **A/AAAA** record for `$APP_DOMAIN` at your server's public IP.
2. Open inbound **80** and **443** (`ufw allow 80,443/tcp`). Keep everything else
   closed (SSH from trusted IPs only). The API/dashboard ports (3001/3000) must
   **not** be reachable from the internet.

## Issuing the first certificate

> **First-boot chicken-and-egg:** the `:443` server block references
> `…/live/$APP_DOMAIN/fullchain.pem`. If that file does not exist, **nginx fails
> to start** (`[emerg] cannot load certificate`), so it cannot serve the ACME
> challenge on `:80` either. Seed a **self-signed placeholder** into the cert
> volume first so nginx starts, then let certbot replace it.

Use the bootstrap helper (`scripts/bootstrap-self-signed-cert.sh`) — it reads the
Let's Encrypt volume name from compose, writes a **1-day** self-signed placeholder
into it, is **safe to re-run**, and **refuses to overwrite a real certificate**
(unless you pass `--force`):

```bash
# 1) Seed the placeholder so nginx can boot on :443 (run ONCE, before `up`):
scripts/bootstrap-self-signed-cert.sh "$APP_DOMAIN"
#    (or: APP_DOMAIN=… scripts/bootstrap-self-signed-cert.sh)

# 2) Start the stack — nginx now boots on :80 + :443 (with the placeholder).
docker compose --env-file .env -f infra/docker/docker-compose.yml up -d
```

The HTTP-01 challenge needs nginx serving `:80` (now true). Issue the real cert:

**Host certbot (recommended):**

```bash
sudo apt-get install -y certbot
sudo certbot certonly --webroot -w /var/lib/docker/volumes/wizer-signage-certbot-webroot/_data \
  -d "$APP_DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email
docker compose --env-file .env -f infra/docker/docker-compose.yml exec nginx nginx -s reload
```

**Containerized certbot (alternative):**

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.certbot.yml \
  run --rm certbot certonly --webroot -w /var/www/certbot \
    -d "$APP_DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email
docker compose --env-file .env -f infra/docker/docker-compose.yml exec nginx nginx -s reload
```

> Test with `--staging` first (Let's Encrypt has strict rate limits); re-issue
> without `--staging` once the flow works.

## Syncing host certs into the Docker volume (REQUIRED with host certbot)

> **Two different locations.** Host certbot writes to
> `/etc/letsencrypt/live/$APP_DOMAIN/`, but the nginx container reads certs from
> the named Docker volume `wizer-signage-letsencrypt` (mounted read-only at
> `/etc/letsencrypt`). They are **not** the same path. After every issuance or
> renewal, the cert must be copied into the volume and nginx reloaded — otherwise
> nginx keeps serving the old (or placeholder) certificate.

A committed helper does exactly this:
`scripts/sync-letsencrypt-to-docker.sh` — it resolves the volume mountpoint via
`docker volume inspect`, copies `fullchain.pem`/`privkey.pem` (dereferencing the
`live/` symlinks), runs `nginx -t`, then `nginx -s reload`.

```bash
# After the first real issuance:
sudo APP_DOMAIN="$APP_DOMAIN" scripts/sync-letsencrypt-to-docker.sh
```

> The **containerized certbot** path mounts the same `wizer-signage-letsencrypt`
> volume directly, so it does **not** need this sync — only host certbot does.

## Renewal

Certificates last 90 days.

- **Host certbot:** the apt package installs a systemd timer/cron that renews
  automatically. Install the sync helper as a **deploy hook** so each renewal
  copies the new cert into the Docker volume and reloads nginx:
  ```bash
  sudo install -m 0755 scripts/sync-letsencrypt-to-docker.sh \
    /etc/letsencrypt/renewal-hooks/deploy/wizer-signage-sync-docker-nginx.sh
  ```
  (certbot sets `RENEWED_LINEAGE`/`RENEWED_DOMAINS`, which the script reads.)
- **Containerized certbot:** `docker compose ... -f docker-compose.certbot.yml up -d certbot`
  runs a loop that renews every 12h into the shared volume; reload nginx after a
  renewal (a host cron `nginx -s reload` daily is the simplest).

## HSTS caution

HSTS is enabled (`max-age=63072000; includeSubDomains`). Browsers cache it and
will refuse plain HTTP for the domain — only keep it on once HTTPS is permanent.
Add `preload` and submit to the preload list only when you are certain.

## Troubleshooting

- **`nginx` is `Restarting` and the logs show `[emerg] cannot load certificate`** —
  the cert files don't exist yet (fresh server, or the cert volume was wiped).
  Seed the placeholder, then start just nginx:
  ```bash
  scripts/bootstrap-self-signed-cert.sh "$APP_DOMAIN"
  docker compose --env-file .env -f infra/docker/docker-compose.yml up -d nginx
  ```
  Then issue/renew the real certificate (above) and `nginx -s reload`.
- **certbot HTTP-01 fails** — confirm DNS points at the server (`dig +short $APP_DOMAIN`),
  ports 80/443 are open, and `http://$APP_DOMAIN/.well-known/acme-challenge/test`
  is reachable while nginx is up.
