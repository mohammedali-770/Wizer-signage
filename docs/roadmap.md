# Implementation Roadmap

The product is delivered in **twelve phases, Phase 0 through Phase 11**. Each phase has a
focused scope and a checklist of deliverables. Later phases build on earlier ones; the
architecture, security model, and tenancy rules established in Phase 0 are binding
throughout.

Legend: `[x]` done · `[~]` in progress · `[ ]` not started.

---

## Phase 0 — Architecture, Monorepo, Tooling `[x] done`

Monorepo skeleton, tooling, and the architecture plan. No business features.

- [x] Define architecture, multi-tenancy, security, and schema **plans** (this `docs/` set)
- [x] pnpm 9 + Turborepo monorepo (`apps/*`, `packages/*`)
- [x] Shared packages scaffolded: `@master-signage/types`, `@master-signage/shared`, `@master-signage/ui`
- [x] Dashboard skeleton (Next.js 14 App Router, Tailwind, next-intl, next-themes, EN/AR)
- [x] API skeleton (NestJS 10, prefix `api`, `/api/health`, `/api/health/ready`)
- [x] Android TV player skeleton (Kotlin, Compose, Media3, Gradle version catalog)
- [x] Docker Compose skeleton (api, dashboard, nginx) + Nginx reverse-proxy config
- [x] `.env.example` with all canonical env vars; documentation set in `docs/`
- [x] CI lint/typecheck wiring

## Phase 1 — Database Schema, Multi-Tenant Foundation, and Auth `[x] done`

The full-product **Prisma schema** is implemented at `apps/api/prisma/schema.prisma`
(init migration `20260614090000_init`). Identity / Auth / Tenancy tables are wired to runtime
modules; fleet / content / scheduling / telemetry / billing / integration tables are
schema-only until their later phases.

- [x] Authoritative **Prisma schema** for all core entities (see [database-schema.md](./database-schema.md)); Supabase Postgres (`DATABASE_URL`, `DIRECT_URL`); migrations + seed (Starter plan, demo company, Super Admin, Company Admin)
- [x] Companies, Users, Roles, **Permissions (RBAC)**, Sessions, Invitations, 2FA models, Activity logs
- [x] Email/password login; JWT access/refresh (rotation + reuse detection)
- [x] Invitations (3-day expiry, single-use); password reset (1-hour single-use token)
- [x] Password policy (>=10 chars, complexity, block weak/common, prevent immediate reuse)
- [x] Account lockout (7 attempts → 15 min; manual unlock; last-active-Super-Admin exempt)
- [x] 2FA (authenticator + backup codes), **required for Super Admin**; server-side **single-use** login challenge
- [x] Sessions: 30-min inactivity logout, active-sessions view, remote termination
- [x] Roles & capability guards; **last-active-Super-Admin protection**
- [x] Multi-tenant foundation: `companyId`-scoped queries + request-scoped `TenantContext` (AsyncLocalStorage) + guards; "never trust client `companyId`"
- [x] Login/audit logging

## Phase 2 — Super Admin SaaS Core `[x] done`

See [super-admin-guide.md](./super-admin-guide.md).

- [x] Super Admin dashboard (protected `/admin` console: overview, companies, plans, subscriptions, invoices, super admins, settings, activity logs)
- [x] Companies CRUD (search/filter/sort, detail + metrics); multiple Super Admins (invite/activate/deactivate, last-admin protection)
- [x] Suspend / reactivate company (blocks users + revokes sessions; data preserved)
- [x] Plans / Subscriptions / Invoices foundation (**no payment gateway in v1**)
- [x] Usage limits + grace-period logic (7-day grace; warn → grace → block)

## Phase 3 — Company Management `[x] done`

See [company-management.md](./company-management.md).

- [x] Company Admin dashboard (`/company` console: overview, locations, screens, groups, tags, map, settings, activity logs)
- [x] Locations / branches; Screens; Screen groups; Screen tags (CRUD, filters, bulk tag/group, move)
- [x] Map view foundation (coordinates per location; provider-flexible with fallback)
- [x] Fallback content placeholders; working hours (company/location/screen); audio settings; kiosk/device foundation (hashed PINs)
- [x] Usage-limit enforcement for locations & screens (Phase 2 grace logic)

## Phase 4 — Content Library `[x] done`

See [content-library.md](./content-library.md).

- [x] Upload images / videos / PDF (Supabase Storage + local dev adapter); URL content; text announcements
- [x] Preview (image/video/PDF/URL/text); tags / categories (reuse Tag system, CONTENT/BOTH); expiry date + filters
- [x] Archive / unarchive; trash / restore (14-day cleanup foundation); soft delete; bulk actions
- [x] Storage tracking + max-file-size & storage-limit enforcement (grace); fallback content wired to real Content (company/location/screen)

## Phase 5 — Playlists and Advanced Scheduling `[x] done`

See [playlists.md](./playlists.md) and [advanced-scheduling.md](./advanced-scheduling.md).

- [x] Playlist builder; per-item duration; PDF page duration; video duration / full playback
- [x] Advanced schedules; days of week; overnight windows; campaigns; recurrence field (future-ready)
- [x] Priority + conflict handling (Emergency > Higher Priority > Campaign > Normal > Fallback)
- [x] Orientation warning; working-hours integration; fallback hierarchy (screen → location → company)
- [x] Schedule resolver + screen playback-manifest endpoint (consumed by the Android player in Phase 6/7)

## Phase 6 — Android TV APK Player Foundation `[x] done`

See [android-player.md](./android-player.md) and [pairing-guide.md](./pairing-guide.md).

- [x] Kotlin / Compose / Media3 Android TV app; device-initiated pairing-code flow; device registration
- [x] Device token auth (separate from user JWT, scoped to one screen) + DeviceAuthGuard; `/device/manifest` + `/device/config`
- [x] Full-screen immersive player; image / video / PDF (first page) / URL / text playback; FALLBACK/NONE handling
- [x] Manifest client (refresh cadence, 401→re-pair); dashboard pair/unpair UI; activity logs

## Phase 7 — Offline Cache and Smart Sync `[x] done`

See [offline-cache.md](./offline-cache.md).

- [x] Device-authenticated content download endpoint (entitlement server-side; range support); sync-plan endpoint
- [x] Local cache (atomic, checksum/size-verified); pre-download ~1h before scheduled content; resume/retry with backoff
- [x] Keep old cache until new content is ready; cleanup keeps current/upcoming/fallback assets
- [x] Offline playback (last-good manifest + cached files); URL skipped offline; neutral local fallback; sync-status reporting + dashboard card

## Phase 8 — Monitoring, Heartbeat, Screenshots, Remote Actions `[x] done`

See [monitoring.md](./monitoring.md).

- [x] Heartbeat API + telemetry; heartbeat-history model; live online/offline/warning status (derived on read)
- [x] Fleet monitoring dashboard + per-screen monitoring & control card; activity logs for actions
- [x] Screenshots (manual; automatic foundation) — best-effort PixelCopy capture of the app's own window (+ documented limits)
- [x] Remote commands (polling delivery): force sync, refresh manifest, restart playback, clear cache, screenshot, reboot (unsupported→fail), reload config, unpair — full command lifecycle
- [ ] Realtime WebSocket gateway / Redis fan-out — deferred (polling delivery shipped; WebSocket is a future enhancement)
- [ ] Kiosk mode; auto-start on boot; APK update mechanism — deferred to a later phase

## Phase 9 — Emergency Broadcast, Proof of Play, Reports `[x] done`

See [proof-of-play.md](./proof-of-play.md) and [emergency-broadcast.md](./emergency-broadcast.md).

- [x] Proof-of-play from real player events only (start/complete/fail/skip/interrupt); idempotent token-scoped ingest; bounded offline buffer + flush
- [x] Proof-of-play reports dashboard (filters, summary cards, most-played, failing screens) + CSV export
- [x] Emergency broadcast (CONTENT / PLAYLIST / TEXT / URL; screen / group / location / company targeting; DRAFT → ACTIVE → PAUSED → ENDED → ARCHIVED)
- [x] Resolver pre-emption: EMERGENCY > schedule > fallback; overrides working hours; highest-priority emergency wins
- [x] Activation/pause/end fan out a REFRESH_MANIFEST command (Phase 8 path) so screens re-resolve promptly; polling catches misses
- [x] Android emergency handling: detect EMERGENCY manifest, interrupt the running item (ITEM_INTERRUPTED), play emergency, return on end
- [ ] Excel / PDF export; scheduled report emails — deferred to Phase 10 (CSV shipped)

## Phase 10 — Notifications, Alerts, Imports, Retention, Backups `[x] done`

See [notifications-alerts.md](./notifications-alerts.md), [imports.md](./imports.md),
[exports-reports.md](./exports-reports.md), [data-retention.md](./data-retention.md),
[backup-restore.md](./backup-restore.md).

- [x] Dashboard notifications (bell + center) + deduplicated alerts (acknowledge/resolve/dismiss); email alerts via `SMTP_*` with `EmailDeliveryLog` audit + per-user preferences
- [x] Alert sources: heartbeat (online/warning), emergency activate/end, backup/report failures, and a maintenance sweep (offline, subscription/grace, storage, content-expiring)
- [x] Excel / CSV import (companies, locations, screens, users, groups, tags) — upload → validate → preview → commit, reusing entity create services + plan limits; tenant-safe
- [x] Exports (CSV/XLSX/print-HTML PDF) for proof-of-play, screen health, alerts, activity logs, screens, locations, companies, invoices
- [x] Scheduled reports (daily/weekly/monthly) with email delivery + delivery logs; enable/disable/run-now
- [x] Data-retention cleanup (90-day defaults; financial records never deleted) + content-trash purge + **emergency auto-END** (completes Phase 9) — CLI/cron runner (no in-process scheduler)
- [x] Backup status model + Super Admin backup health page; backup-failure / overdue alerts; backup script records runs; restore docs ([backup-restore.md](./backup-restore.md))
- [ ] WhatsApp notifications; full webhook delivery; full external API portal; true server-side PDF — deferred (out of scope / future)

## Phase 11 — Production Deployment Hardening `[x] done`

See [production-deployment.md](./production-deployment.md), [docker-production.md](./docker-production.md),
[nginx-ssl.md](./nginx-ssl.md), [security-hardening.md](./security-hardening.md),
[monitoring-operations.md](./monitoring-operations.md), [performance-testing.md](./performance-testing.md).

- [x] Production Docker images (api, dashboard, maintenance-worker) — multi-stage, non-root, healthcheck-friendly, no secrets baked in; root `.dockerignore`
- [x] Production compose (api + dashboard + maintenance + nginx; Supabase external, no prod DB) — resource limits, log rotation, healthchecks, build args, backup volume; optional certbot override
- [x] Nginx reverse proxy hardened: security headers (HSTS + 4), 512 MB uploads + streaming, static caching, `${APP_DOMAIN}` template
- [x] Let's Encrypt SSL (host + containerized certbot) docs; DNS/firewall; HSTS caution
- [x] Environment/secrets finalized: `infra/docker/.env.production.example` + updated `environment-variables.md`; Swagger disabled in production
- [x] Health checks: real readiness probe (DB connectivity → 503; storage/mail flags, no secrets)
- [x] Maintenance cron wired (busybox crond worker: sweep/reports/emergencies + nightly retention + backup)
- [x] Backup production wiring (pg_dump → volume, recorded in BackupRecord, failure alerts, restore docs)
- [x] Logging/observability foundation ([monitoring-operations.md](./monitoring-operations.md)); load-test foundation (k6, [performance-testing.md](./performance-testing.md))
- [x] Security hardening review ([security-hardening.md](./security-hardening.md)); Android production handoff notes
- [ ] Docker image build verification — NOT runnable in this sandbox (no Docker CLI); compose YAML validated, build documented

---

## Out of scope for v1

Carried as explicit non-goals (see [architecture.md](./architecture.md)):

- [ ] No design editor
- [ ] No dynamic menu builder
- [ ] No payment gateway

## Related docs

- [architecture.md](./architecture.md) · [multi-tenancy.md](./multi-tenancy.md) ·
  [security.md](./security.md) · [database-schema.md](./database-schema.md)
