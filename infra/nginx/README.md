# Nginx — Reverse Proxy & TLS

This directory holds the Nginx configuration that fronts the MasterSignage
stack. Nginx terminates TLS and routes traffic to the application services:

| Path                        | Upstream         | Notes                            |
| --------------------------- | ---------------- | -------------------------------- |
| `/`                         | `dashboard:3000` | Next.js dashboard                |
| `/api/`                     | `api:3001`       | NestJS API (prefix preserved)    |
| `<WS_PATH>` (default `/ws`) | `api:3001`       | WebSocket upgrade, long timeouts |

## Files

- **`nginx.conf`** — main config: worker/event tuning, gzip, shared proxy and
  WebSocket-upgrade settings, and `include /etc/nginx/conf.d/*.conf`.
- **`conf.d/master-signage.conf`** — the server blocks: an HTTP (`:80`) server
  for the ACME challenge + HTTPS redirect, and an HTTPS (`:443`) server with
  the routing rules above.

## Before you start

1. Replace every `signage.example.com` placeholder in
   `conf.d/master-signage.conf` (both `server_name` directives and the two
   `ssl_certificate*` paths) with your real domain.
2. Make sure DNS for your domain points at the host running this stack.
3. Confirm `WS_PATH` in your `.env` matches the WebSocket `location` block
   (default `/ws`; if you use Socket.IO's default `/socket.io`, update the
   location prefix accordingly).

## Mount points (from `docker-compose.yml`)

| Host path                | Container path          | Purpose                         |
| ------------------------ | ----------------------- | ------------------------------- |
| `infra/nginx/nginx.conf` | `/etc/nginx/nginx.conf` | Main config (read-only)         |
| `infra/nginx/conf.d`     | `/etc/nginx/conf.d`     | Server blocks (read-only)       |
| `certbot-webroot` volume | `/var/www/certbot`      | ACME HTTP-01 challenge files    |
| `letsencrypt` volume     | `/etc/letsencrypt`      | Issued certificates (read-only) |

## Obtaining certificates (Let's Encrypt, webroot)

The HTTP server block serves `/.well-known/acme-challenge/` from
`/var/www/certbot`, which is the `certbot-webroot` volume. Issue the first
certificate by running certbot against that same volume:

```bash
# Run a one-off certbot container sharing the webroot + letsencrypt volumes.
docker run --rm \
  -v master-signage-certbot-webroot:/var/www/certbot \
  -v master-signage-letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly \
    --webroot -w /var/www/certbot \
    -d signage.example.com \
    --email admin@example.com \
    --agree-tos --no-eff-email
```

Notes:

- Nginx must already be running and reachable on port 80 so the challenge can
  be served. If TLS is not yet issued, temporarily comment out the HTTPS
  server block (or its `ssl_certificate*` lines) so nginx can start.
- Replace `signage.example.com` and the email with your real values.

## Renewing certificates

Let's Encrypt certificates are valid for 90 days. Renew with:

```bash
docker run --rm \
  -v master-signage-certbot-webroot:/var/www/certbot \
  -v master-signage-letsencrypt:/etc/letsencrypt \
  certbot/certbot renew
```

Automate this via cron (e.g. twice daily). After a successful renewal, reload
nginx so it picks up the new certificate (see below). For unattended setups,
add `--deploy-hook` to certbot to trigger the reload automatically.

## Reloading nginx

After changing any config file or renewing certificates, reload without
downtime:

```bash
docker compose -f infra/docker/docker-compose.yml exec nginx nginx -s reload
```

Validate the configuration before reloading:

```bash
docker compose -f infra/docker/docker-compose.yml exec nginx nginx -t
```

See `docs/production-deployment.md` for the full deployment workflow.
