# Wizer Signage Documentation

Wizer Signage is a multi-tenant digital signage SaaS platform: a Next.js dashboard,
a NestJS API, and a native Android TV player, backed by Supabase (Postgres + Storage).
This directory is the canonical documentation set for the platform.

> Status: **Phase 0** — architecture, monorepo skeleton, tooling, and planning.
> The documents below describe the target system and the plan to build it. Sections
> that land in later phases are explicitly labeled.

## Documentation index

### Architecture & planning

- [architecture.md](./architecture.md) — Full system architecture: components, data flows, request lifecycle, realtime strategy, tech stack, and v1 non-goals.
- [multi-tenancy.md](./multi-tenancy.md) — Tenant isolation strategy: `companyId` scoping, request-scoped tenant context, super-admin access, and future white-label/reseller readiness.
- [security.md](./security.md) — Security model: roles & capability matrix, authentication, 2FA, password policy, account lockout, sessions, and audit logging.
- [database-schema.md](./database-schema.md) — Phase-0 overview of the planned core entities, relationships, tenant scoping, and data-retention defaults (the concrete Prisma schema lands in Phase 1).
- [roadmap.md](./roadmap.md) — Phased implementation plan (Phase 0 through Phase 11) with per-phase scope checklists.

### Operations & configuration

- [environment-variables.md](./environment-variables.md) — Every environment variable, its purpose, and example values.
- [local-development.md](./local-development.md) — Getting the monorepo running locally (pnpm, Turborepo, Docker, Supabase).
- [production-deployment.md](./production-deployment.md) — Phase 11 deployment runbook: server prep, migrations, seed, go-live verification, rollback.
- [staging-runbook.md](./staging-runbook.md) — **Staging deployment & verification runbook**: 16-step checklist with exact commands to validate the full stack end-to-end before go-live, plus a sign-off report template.
- [deploy-wizer-rebrand-and-domain.md](./deploy-wizer-rebrand-and-domain.md) — **One-time runbook**: ship the `master-signage*` → `wizer-signage*` rename and the `wizer.sa` domain switch together (remove old containers → issue `wizer.sa` cert → rebuild/bake new URLs → verify).
- [docker-production.md](./docker-production.md) — Phase 11 Docker stack: images, compose, build args vs runtime env, maintenance worker.
- [nginx-ssl.md](./nginx-ssl.md) — Phase 11 Nginx reverse proxy, security headers, and Let's Encrypt (host + containerized).
- [security-hardening.md](./security-hardening.md) — Phase 11 security review + production hardening checklist.
- [monitoring-operations.md](./monitoring-operations.md) — Phase 11 logging, health endpoints, observability foundation, routine ops.
- [performance-testing.md](./performance-testing.md) — Phase 11 load-test foundation (k6) + capacity notes.
- [backup-restore.md](./backup-restore.md) — Backup and restore procedures for database and storage.

### Reference & guides

- [api-future.md](./api-future.md) — Planned public/partner API surface (post-v1).
- [android-player.md](./android-player.md) — Android TV player architecture, build, and behavior.
- [pairing-guide.md](./pairing-guide.md) — How to pair a screen to a company using a pairing code.
- [admin-guide.md](./admin-guide.md) — Day-to-day administration for company and location admins.
- [super-admin-guide.md](./super-admin-guide.md) — Phase 2 Super Admin SaaS core: companies, plans, subscriptions, invoices, usage limits, suspension.
- [company-management.md](./company-management.md) — Phase 3 Company Management: locations, screens, groups, tags, map, working hours, audio, kiosk/device settings.
- [content-library.md](./content-library.md) — Phase 4 Content Library: upload/URL/text, preview, tags, expiry, archive/trash/restore, storage limits, fallback content.
- [playlists.md](./playlists.md) — Phase 5 Playlists: builder, per-item duration, full-video / PDF page duration, validity, orientation profile.
- [advanced-scheduling.md](./advanced-scheduling.md) — Phase 5 Schedules & playback manifest: targeting, priority/conflict rules, working hours, resolver, Android handoff.
- [offline-cache.md](./offline-cache.md) — Phase 7 Offline cache & smart sync: device download/sync-plan/sync-status endpoints, cache architecture, pre-download, offline playback.
- [monitoring.md](./monitoring.md) — Phase 8 Monitoring, heartbeat & remote actions: heartbeat/telemetry, status calculation, remote commands, screenshots, fleet dashboard.
- [proof-of-play.md](./proof-of-play.md) — Phase 9 Proof of Play: real-event reporting, heartbeat/sync/PoP distinction, event lifecycle, offline buffering, reports & CSV export.
- [emergency-broadcast.md](./emergency-broadcast.md) — Phase 9 Emergency Broadcast: model/lifecycle, resolver pre-emption & priority, targeting, command fan-out, Android behavior, emergency PoP.
- [notifications-alerts.md](./notifications-alerts.md) — Phase 10 Notifications & Alerts: dedup/auto-resolve, alert sources, SMTP email + delivery log, preferences, dashboard bell/center.
- [imports.md](./imports.md) — Phase 10 Bulk imports: CSV/XLSX upload → validate → preview → commit, templates, tenant safety, plan limits.
- [exports-reports.md](./exports-reports.md) — Phase 10 Exports (CSV/XLSX/PDF) + scheduled reports (delivery + logs).
- [data-retention.md](./data-retention.md) — Phase 10 Retention cleanup, alert sweep, emergency auto-END, the maintenance CLI/cron, financial-record exclusion.
- [device-limitations.md](./device-limitations.md) — Known device/platform constraints and supported hardware.

## Where to start

- **New to the project?** Read [architecture.md](./architecture.md) first for the big
  picture, then [roadmap.md](./roadmap.md) to see what is built and what is next.
- **Setting up locally?** Go to [local-development.md](./local-development.md) and
  [environment-variables.md](./environment-variables.md).
- **Working on the backend?** Read [multi-tenancy.md](./multi-tenancy.md) and
  [security.md](./security.md) before writing any tenant-scoped or auth code — they
  encode rules other code depends on.
- **Working on the player or kiosks?** See [android-player.md](./android-player.md),
  [pairing-guide.md](./pairing-guide.md), and [device-limitations.md](./device-limitations.md).
- **Deploying?** See [production-deployment.md](./production-deployment.md) and
  [backup-restore.md](./backup-restore.md).

## Conventions

- Package manager **pnpm 9**, Node **>= 20**, task runner **Turborepo**.
- **TypeScript 5.4+, strict** across all TypeScript packages.
- Author/brand: **Wizer Signage** · Year: **2026** · License: **UNLICENSED** (proprietary).
- All UI renders **English/Latin digits** even in Arabic (RTL) — see
  [architecture.md](./architecture.md) and the dashboard number formatter.
