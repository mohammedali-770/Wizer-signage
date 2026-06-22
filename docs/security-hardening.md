# Security Hardening Review (Phase 11)

A production-readiness security checklist mapping each control to where it is
enforced in the codebase/infra. Items marked ✅ are implemented; ⚠️ are
operator responsibilities to confirm at deploy time.

## Identity, tenancy & access

- ✅ **Tenant isolation** — every company-scoped query derives `companyId` from
  the JWT (`@CurrentCompany`), never the request body; cross-tenant access
  returns 404. Bulk imports take `companyId` from the token, never the file
  ([imports.md](./imports.md)).
- ✅ **Device token scope** — opaque, sha256-hashed, bound to one screen
  (`DeviceAuthGuard`); carries no dashboard authority.
- ✅ **RBAC** — `PermissionsGuard` + a fixed role→permission map
  (`common/rbac/permissions.ts`). Admin/maintenance endpoints are
  `@Roles(SUPER_ADMIN)`; `report:schedule` / `import:run` / `alert:manage`
  gate the Phase 10 surfaces.
- ✅ **2FA mandatory for Super Admin** — `TwoFactorEnforcementGuard` forces TOTP
  enrolment; secrets AES-256-GCM encrypted at rest (`ENCRYPTION_KEY`).
- ✅ **Maintenance + backup endpoints** — `POST /admin/maintenance/run`,
  `GET/POST /admin/backups` are Super-Admin-only.
- ✅ **Dashboard route protection** — both shells redirect by role; tokens in
  localStorage with one-shot refresh on 401.

## Transport, headers & CORS

- ✅ **Helmet** security headers on the API (`main.ts`); **nginx** adds HSTS +
  `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` /
  `Permissions-Policy`.
- ✅ **TLS 1.2/1.3 only**, `server_tokens off`, session tickets off (nginx).
- ⚠️ **CORS** — set `CORS_ORIGINS` to your dashboard origin(s). The default `*`
  is dev-only; **lock it down** in production.
- ✅ **Swagger** — disabled in production (`SWAGGER_ENABLED=true` to force on a
  locked-down staging host only).

## Rate limiting & abuse

- ✅ **Throttling** — global `ThrottlerGuard` (100 req/min). Health probes are
  `@SkipThrottle()`.
- ✅ **Auth lockout** — failed-login lockout (7 attempts / 15 min), last-super-
  admin exempt.

## Files & storage

- ✅ **Upload limits** — content 300 MB, screenshots 12 MB, imports 15 MB (Nest
  interceptors); nginx `client_max_body_size 512m` ceiling.
- ✅ **Magic-byte validation** — content type detected from file bytes, not the
  client MIME (`detectFileType`); screenshots validated by magic bytes.
- ✅ **Supabase service role server-only** — never sent to the browser; signed,
  short-lived URLs for reads; no public unrestricted storage URLs (private
  bucket; local-dev fallback uses encrypted token URLs + `nosniff`/CSP).
- ✅ **CSV/XLSX exports** — formula-injection hardened (`csvCell`).

## Secrets

- ✅ **No secrets in images** — Dockerfiles bake only the public
  `NEXT_PUBLIC_API_URL`; all secrets come from runtime env.
- ✅ **No secrets in git** — `.env*` ignored (only `*.example` committed); docs
  use placeholders + `openssl rand` generation guidance.
- ✅ **Strong secrets enforced at boot** — `JWT_*` / `ENCRYPTION_KEY` required +
  min 16 chars (`env.validation.ts`); use 48+.
- ⚠️ **Backup/SMTP secrets** — `DATABASE_URL` / `SMTP_PASSWORD` live only in the
  server `.env` (mode `600`, owner-only); never echoed by scripts.

## Containers & network

- ✅ **Non-root** — api (`node`), dashboard (`nextjs`); maintenance runs jobs as
  `node` via `su-exec` (crond bootstraps as root only to schedule).
- ✅ **Network exposure minimized** — only nginx publishes 80/443; api/dashboard
  are `expose`-only on the internal bridge network; no production DB container.
- ✅ **Healthchecks + restart policies** + resource limits + log rotation on all
  services.

## Operational

- ✅ **Financial records never deleted** by retention (no code path touches
  Invoice/Subscription).
- ✅ **Audit trail** — admin actions logged; email sends in `EmailDeliveryLog`;
  alerts deduped (no spam).
- ⚠️ **Firewall** — only 80/443 inbound; SSH from trusted IPs.

## Dependency audit

Run before each release (fix highs/criticals; document accepted advisories):

```bash
pnpm audit --prod            # production dependencies
pnpm --filter @master-signage/api audit
pnpm --filter @master-signage/dashboard audit
docker scout cves master-signage/api:latest   # optional image CVE scan
```

### Current advisory triage (as of this phase)

- ⚠️ **Next.js 14.2.x** carries upstream advisories patched in **15.5.16+**
  (`pnpm audit` reports them via `apps/dashboard > next`). Upgrading Next 14 → 15
  is a **framework major** with real breakage risk and is **out of scope for a
  hardening pass** — plan it as a dedicated dependency-upgrade task, test the
  dashboard (App Router, `next-intl`, standalone build) thoroughly, then bump.
  Mitigations meanwhile: the dashboard is served only behind nginx (no direct
  exposure), and several advisories concern SSR/image features this app does not
  use. Re-run `pnpm audit` each release and prioritise **high/critical** fixes
  that don't require a major upgrade.
- Run `pnpm audit` before every release; record accepted advisories with a
  rationale + a review date.

## Phase 11 fixes applied

- Swagger UI **disabled in production** (was exposed in all environments).
- Readiness probe now verifies **DB connectivity** and returns **503** when not
  ready — exposing **only booleans** (no secrets/hosts).
- nginx security headers (HSTS + the four headers above) enabled (were commented
  out / absent).

## Known limitations (documented, not bugs)

- No WAF/IDS in front of nginx — add Cloudflare/your provider's WAF if desired.
- Rate limiting is per-instance in-memory (no shared Redis store) — acceptable
  for a single API replica; use a shared store if you scale `api` horizontally.
- No automated secret rotation — rotate `JWT_*`/`ENCRYPTION_KEY` manually
  (rotating `ENCRYPTION_KEY` invalidates stored 2FA secrets → users re-enrol).
