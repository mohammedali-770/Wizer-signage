# Wizer Signage

**Wizer Signage** is a **multi-tenant digital signage SaaS platform** for **Android TV**.
It lets organizations manage screens, schedule playlists, and stream media to
networks of Android TV devices from a single, multi-tenant web dashboard — in Arabic or English.

Wizer Signage is a product of **WIZER** — a Saudi SaaS company building smart business
software. _Smart Systems. Clearer Decisions._

> **Naming note:** the WIZER / Wizer Signage rename is applied throughout — user-facing
> text, the npm workspace scope (`@wizer/*`), Docker images/containers (`wizer-signage/*`),
> the API service name, the Android **app id** _and_ **source package** (`com.wizer.signage`).
> The Android Kotlin package move (`com.mastersignage.player` → `com.wizer.signage`) is
> complete and **build-verified**: `assembleDebug` / `assembleRelease` and unit tests pass,
> and the built APK's package name is `com.wizer.signage`. The old `/mastersignage` and
> `/master-signage` URLs still redirect to `/signage` for backward compatibility.

> **Status: Feature-complete (Phases 0–11 done) — pre-launch verification.**
> All product phases in [docs/roadmap.md](docs/roadmap.md) are implemented:
> multi-tenant auth/RBAC, Super Admin SaaS core, company/content/playlist
> management, scheduling, the Android TV player with offline cache, monitoring,
> emergency broadcast, proof-of-play, notifications/imports/exports, retention/
> backups, and production Docker/Nginx hardening. Remaining work before launch
> is production provisioning and deployment verification (see
> [docs/production-deployment.md](docs/production-deployment.md)).

## Monorepo layout

```
wizer-signage/
├── apps/
│   ├── dashboard/          # Next.js 15 (App Router) admin dashboard — port 3000
│   ├── api/                # NestJS 11 REST API — port 3001
│   └── android-tv-player/  # Kotlin / Jetpack Compose Android TV player
├── packages/
│   ├── types/              # @wizer/types  — shared TypeScript types/enums
│   ├── shared/             # @wizer/shared — shared constants/utilities
│   └── ui/                 # @wizer/ui     — shared React UI foundation
├── infra/
│   ├── docker/             # Docker Compose & related infrastructure
│   └── nginx/              # Reverse proxy configuration
├── scripts/                # Repo automation scripts
└── docs/                   # Project documentation
```

## Tech stack

| Area           | Technology                                                     |
| -------------- | -------------------------------------------------------------- |
| Monorepo       | pnpm 9 workspaces + Turborepo                                  |
| Language       | TypeScript 5.4 (strict) · Kotlin 2.4                           |
| Dashboard      | Next.js 15 (App Router), React 18, Tailwind CSS 3.4, next-intl |
| API            | NestJS 11 (REST; devices poll — no socket transport)           |
| Android        | Jetpack Compose, Media3 ExoPlayer (Android TV / leanback)      |
| Data & Storage | Supabase (PostgreSQL + Storage)                                |
| Infra          | Docker Compose, Nginx reverse proxy, Let's Encrypt SSL         |

## Prerequisites

- **Node.js** >= 22.18.0 (see [`.nvmrc`](.nvmrc)). `.npmrc` sets `engine-strict=true`,
  so `pnpm install` FAILS on an older Node rather than warning.
- **pnpm** >= 9 (`corepack enable` recommended)
- **Docker** & Docker Compose (for local infrastructure and deployment)
- For Android development: **JDK 17**, Android Studio, Gradle 8 / AGP 8

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Create your environment file
cp .env.example .env   # then edit values

# 3. Run all apps in development
pnpm dev
```

## Workspaces & apps

| App / Package            | Package name        | Dev URL / port            |
| ------------------------ | ------------------- | ------------------------- |
| `apps/dashboard`         | (Next.js dashboard) | http://localhost:3000     |
| `apps/api`               | (NestJS API)        | http://localhost:3001/api |
| `apps/android-tv-player` | (Android TV player) | —                         |
| `packages/types`         | `@wizer/types`      | —                         |
| `packages/shared`        | `@wizer/shared`     | —                         |
| `packages/ui`            | `@wizer/ui`         | —                         |

### Common scripts

| Script              | Description                            |
| ------------------- | -------------------------------------- |
| `pnpm dev`          | Run all apps in watch mode (Turborepo) |
| `pnpm build`        | Build all apps and packages            |
| `pnpm lint`         | Lint the workspace                     |
| `pnpm typecheck`    | Type-check the workspace               |
| `pnpm format`       | Format all files with Prettier         |
| `pnpm format:check` | Check formatting without writing       |
| `pnpm clean`        | Remove build artifacts                 |

## Marketing website & self-service trials

The public marketing website is built **into the dashboard app** (Next.js App Router)
under the `[locale]/(marketing)` route group, so it reuses the existing brand, fonts,
and Arabic/English (RTL) i18n. It is served at the site root:

| Route                                  | Page                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `/`                                    | Home (hero, problem/solution, features, how-it-works, industries, pricing preview, FAQ, CTA) |
| `/features`, `/industries`, `/pricing` | Product pages (pricing reads live plans from the API)                                        |
| `/trial`                               | **Start Free Trial** — creates a real tenant account                                         |
| `/demo`                                | **Book a Demo** — stores a lead                                                              |
| `/privacy`, `/terms`                   | Legal                                                                                        |
| `/login`                               | Existing dashboard login                                                                     |

### How trial signup works (end-to-end, not a mock)

`POST /api/public/trial-signup` (public, rate-limited 5/hr) atomically creates, in one
Prisma transaction: a **Company** (tenant) + an **owner User** with role
`COMPANY_ADMIN` (Argon2id-hashed password — _not_ a platform Super Admin) + a
**TRIALING Subscription** (length = `TRIAL_DAYS`, plan = `DEFAULT_TRIAL_PLAN`) + a default
**Location** (branch). It rejects duplicate emails, enforces the password policy, writes an
audit-log entry, and sends a best-effort welcome email. The trial form then sends the user
to `/login` to sign in. `POST /api/public/demo-request` stores a `DemoRequest` and notifies
sales (best-effort). `GET /api/public/plans` returns the active public plans for the pricing page.

### Super Admin trial management

The Super Admin console (`/admin`) gains: trial/paid/demo metrics + recent signups on the
overview, a **Trials** page (`/admin/trials` — convert to paid, extend, disable, view) and a
**Demo Requests** page (`/admin/demo-requests` — review + update status).

### Configuration & seed

Set in `.env` (see `.env.example`): `TRIAL_DAYS=14`, `DEFAULT_TRIAL_PLAN=starter`,
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_DASHBOARD_URL`, optional `SALES_NOTIFY_EMAIL`, and SMTP
for real emails (otherwise emails are logged in dev). The seed is plain CommonJS
(`prisma/seed.cjs`) so it runs with only `node` + production deps — locally via
`pnpm --filter @wizer/api db:seed`, and **in the production container** via:

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml exec api node prisma/seed.cjs
```

It seeds the **Starter / Business / Enterprise** plans (SAR, editable in the DB; idempotent —
re-seeding restores the catalog defaults but never duplicates the demo company/users).

### Testing it

```bash
# API (unit) — includes PublicService (trial signup) tests
pnpm --filter @wizer/api test
# Trial signup against a running API:
curl -X POST http://localhost:3001/api/public/trial-signup \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"Test User","companyName":"Test Co","email":"test@example.com","password":"StrongPass!23","preferredLanguage":"en"}'
```

Then visit `/trial` and `/demo` (toggle Arabic to verify RTL), sign in with the created
account, and review the signup in `/admin/trials`.

## Documentation

All project documentation lives in [`docs/`](docs/):

- [docs/README.md](docs/README.md) — documentation index
- [docs/architecture.md](docs/architecture.md) — system architecture
- [docs/multi-tenancy.md](docs/multi-tenancy.md) — multi-tenancy model
- [docs/security.md](docs/security.md) — security model
- [docs/database-schema.md](docs/database-schema.md) — database schema
- [docs/roadmap.md](docs/roadmap.md) — phased delivery roadmap
- [docs/environment-variables.md](docs/environment-variables.md) — environment variable reference
- [docs/local-development.md](docs/local-development.md) — local development guide
- [docs/production-deployment.md](docs/production-deployment.md) — production deployment
- [docs/backup-restore.md](docs/backup-restore.md) — backup & restore
- [docs/api-future.md](docs/api-future.md) — future public API plans
- [docs/android-player.md](docs/android-player.md) — Android TV player
- [docs/pairing-guide.md](docs/pairing-guide.md) — device pairing guide
- [docs/admin-guide.md](docs/admin-guide.md) — administrator guide
- [docs/device-limitations.md](docs/device-limitations.md) — device limitations

## License

Proprietary — © 2026 Wizer Signage. All rights reserved. See [LICENSE](LICENSE).
