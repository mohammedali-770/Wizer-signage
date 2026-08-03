# Nginx — Reverse Proxy & TLS

This directory holds the Nginx configuration that fronts the Wizer Signage
stack. Nginx terminates TLS and routes traffic to the application services:

| Path    | Upstream         | Notes                         |
| ------- | ---------------- | ----------------------------- |
| `/`     | `dashboard:3000` | Next.js dashboard             |
| `/api/` | `api:3001`       | NestJS API (prefix preserved) |

## Files

- **`nginx.conf`** — main config: worker/event tuning, gzip, shared proxy and
  WebSocket-upgrade settings, and `include /etc/nginx/conf.d/*.conf`.
- **`templates/wizer-signage.conf.template`** — the server blocks (HTTP `:80`
  ACME + redirect, HTTPS `:443` routing), templated with `${APP_DOMAIN}`. The
  nginx image runs `envsubst` on this at startup and writes the rendered config
  to `/etc/nginx/conf.d/`. **There is no hardcoded domain in any active config.**

## Before you start

1. Set `APP_DOMAIN` in the repo-root `.env` (e.g. `wizer.sa`). The
   compose `nginx` service substitutes it into `server_name` and the
   `ssl_certificate*` paths at startup — nothing to hand-edit.
2. Make sure DNS for your domain points at the host running this stack.
3. Confirm the upstream service names match your compose services
   (default `/ws`; if you use Socket.IO's default `/socket.io`, update the
   location prefix in the template accordingly).

## Mount points (from `docker-compose.yml`)

| Host path                | Container path          | Purpose                              |
| ------------------------ | ----------------------- | ------------------------------------ |
| `infra/nginx/nginx.conf` | `/etc/nginx/nginx.conf` | Main config (read-only)              |
| `infra/nginx/templates`  | `/etc/nginx/templates`  | `${APP_DOMAIN}` server template (ro) |
| `certbot-webroot` volume | `/var/www/certbot`      | ACME HTTP-01 challenge files         |
| `letsencrypt` volume     | `/etc/letsencrypt`      | Issued certificates (read-only)      |

> **Host certbot users:** certs issued on the host at
> `/etc/letsencrypt/live/$APP_DOMAIN/` must be synced into the
> `wizer-signage-letsencrypt` volume that nginx reads. Use
> `scripts/sync-letsencrypt-to-docker.sh` (also installable as a certbot deploy
> hook). See `docs/nginx-ssl.md`.

## Obtaining certificates (Let's Encrypt, webroot)

The HTTP server block serves `/.well-known/acme-challenge/` from
`/var/www/certbot`, which is the `certbot-webroot` volume. Issue the first
certificate by running certbot against that same volume:

```bash
# Run a one-off certbot container sharing the webroot + letsencrypt volumes.
docker run --rm \
  -v wizer-signage-certbot-webroot:/var/www/certbot \
  -v wizer-signage-letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly \
    --webroot -w /var/www/certbot \
    -d wizer.sa \
    --email ops@wizer.sa \
    --agree-tos --no-eff-email
```

Notes:

- Nginx must already be running and reachable on port 80 so the challenge can
  be served. If TLS is not yet issued, temporarily comment out the HTTPS
  server block (or its `ssl_certificate*` lines) so nginx can start.
- Replace `wizer.sa` and the email with your real values.

## Renewing certificates

Let's Encrypt certificates are valid for 90 days. Renew with:

```bash
docker run --rm \
  -v wizer-signage-certbot-webroot:/var/www/certbot \
  -v wizer-signage-letsencrypt:/etc/letsencrypt \
  certbot/certbot renew
```

Automate this via cron (e.g. twice daily). After a successful renewal, reload
nginx so it picks up the new certificate (see below). For unattended setups,
add `--deploy-hook` to certbot to trigger the reload automatically.

## Reloading nginx

After changing any config file or renewing certificates, reload without
downtime:

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml exec nginx nginx -s reload
```

Validate the configuration before reloading:

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml exec nginx nginx -t
```

See `docs/production-deployment.md` for the full deployment workflow.
