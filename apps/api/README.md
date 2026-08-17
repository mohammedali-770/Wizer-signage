# @wizer/api

NestJS 11 backend for **Wizer Signage** — the multi-tenant digital signage SaaS platform.

This package is the REST API. It runs as a standalone Node service and is
consumed by the Next.js dashboard and the Android TV player.

> **Complete.** Every phase in [`docs/roadmap.md`](../../docs/roadmap.md) has
> shipped. Fleet, content, scheduling, telemetry and billing all have service
> layers registered in the root module — this note used to say they were
> schema-only and awaiting later phases, which stopped being true several phases
> ago.

## Tech stack

- **NestJS 11** on `@nestjs/platform-express`
- **TypeScript 5.4+**, strict
- **Prisma** ORM over Supabase Postgres (`DATABASE_URL` pooled, `DIRECT_URL` for migrations)
- `@nestjs/config` — typed, validated environment configuration
- `@nestjs/throttler` — rate limiting
- `@nestjs/swagger` — OpenAPI docs at `/api/docs`
- `helmet` — security headers
- `class-validator` / `class-transformer` — DTO validation
- **Argon2id** password hashing, **TOTP** 2FA, JWT access/refresh tokens
- `nodemailer` — SMTP (or dev JSON transport) for transactional email

Internal workspace packages consumed as TypeScript source:
`@wizer/types`, `@wizer/shared`.

## Modules

| Module              | Responsibility                                                 |
| ------------------- | -------------------------------------------------------------- |
| **Prisma** (global) | Database client, lifecycle, scoped access                      |
| **Common**          | Crypto, password hashing/policy, request-scoped tenant context |
| **Mail**            | SMTP transport (dev JSON transport fallback)                   |
| **Auth**            | Login, refresh, logout, password reset, invitation acceptance  |
| **Users**           | User CRUD, enable/disable/unlock                               |
| **Sessions**        | Active-session view, remote termination, inactivity timeout    |
| **Invitations**     | Single-use, 3-day-expiry invites                               |
| **Two-Factor**      | TOTP enrollment, backup codes, enforcement                     |
| **Companies**       | Tenant profile (`GET /companies/me`)                           |
| **Activity-Log**    | Audit and login-event logging                                  |
| **Health**          | Liveness / readiness probes                                    |

## Conventions

- Global route prefix: **`api`**
- Port: **`API_PORT`** (default `3001`)
- Health: `GET /api/health`, `GET /api/health/ready`
- Swagger UI: `GET /api/docs`
- All errors are normalized to `{ success: false, error: { code, message, details } }`

## Scripts

| Script                   | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `pnpm build`             | Compile with `nest build` → `dist/`                 |
| `pnpm start`             | Start the app                                       |
| `pnpm start:dev`         | Start in watch mode                                 |
| `pnpm start:prod`        | Run the compiled build (`node dist/main.js`)        |
| `pnpm lint`              | ESLint                                              |
| `pnpm typecheck`         | `tsc --noEmit`                                      |
| `pnpm test`              | Unit tests (Jest)                                   |
| `pnpm test:e2e`          | End-to-end tests                                    |
| `pnpm db:generate`       | Generate the Prisma client                          |
| `pnpm db:migrate`        | Apply migrations in development (`migrate dev`)     |
| `pnpm db:migrate:deploy` | Apply pending migrations in production              |
| `pnpm db:seed`           | Seed plan, demo company, Super Admin, Company Admin |
| `pnpm db:studio`         | Open Prisma Studio                                  |

## Database setup

The **Prisma schema is the authoritative data model**
(`prisma/schema.prisma`), with the initial migration at
`prisma/migrations/20260614090000_init/migration.sql`.

```bash
# 1. Install dependencies (from the repo root)
pnpm install

# 2. Copy and fill env: DATABASE_URL / DIRECT_URL (Supabase),
#    JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY
cp .env.example .env

# 3. Generate the Prisma client
pnpm --filter @wizer/api db:generate

# 4. Apply the init migration
pnpm --filter @wizer/api db:migrate:deploy   # production
# or, for development:
pnpm --filter @wizer/api db:migrate

# 5. Seed a Starter plan, a demo company + trialing subscription,
#    a Super Admin and a Company Admin (prints credentials)
pnpm --filter @wizer/api db:seed

# 6. Run the API
pnpm --filter @wizer/api start:dev
```

Swagger is then available at `/api/docs`.

## Endpoints (`/api` prefix)

| Area              | Endpoints                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Auth**          | `POST /auth/login`, `POST /auth/login/2fa`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/accept-invitation`, `GET /auth/me` |
| **Two-Factor**    | `POST /auth/2fa/setup`, `POST /auth/2fa/enable`, `POST /auth/2fa/disable`, `GET /auth/2fa/status`                                                                                                |
| **Users**         | `GET /users`, `GET /users/:id`, update, disable, enable, unlock, delete                                                                                                                          |
| **Sessions**      | list / terminate under `/sessions`                                                                                                                                                               |
| **Invitations**   | manage under `/invitations`                                                                                                                                                                      |
| **Companies**     | `GET /companies/me`                                                                                                                                                                              |
| **Activity logs** | `GET /activity-logs`                                                                                                                                                                             |
| **Health**        | `GET /health`, `GET /health/ready`                                                                                                                                                               |

## Security model

- **Argon2id** password hashing.
- **Password policy:** ≥10 chars, complexity rules, common-password blocklist, immediate-reuse prevention.
- **Account lockout:** 7 failed attempts → 15-minute lock; manual unlock.
- **JWT access + refresh** tokens with rotation and refresh-token reuse detection.
- **Sessions:** 30-minute inactivity auto-logout, active-sessions view, remote termination.
- **2FA:** TOTP with backup codes; **mandatory for Super Admin** (forced enrollment), enforced by a global guard.
- **Invitations:** single-use tokens, 3-day expiry. **Password reset:** single-use token, 1-hour expiry.
- **Last-active-Super-Admin protection** prevents lockout of the platform.
- **Tenant isolation:** `companyId`-scoped queries + request-scoped `AsyncLocalStorage` context + guards.
- **Audit / activity logging** of security- and tenant-significant actions, including login events.

Global guard order: **Throttler → JwtAuthGuard (with `@Public`) → RolesGuard →
PermissionsGuard → TenantGuard → TwoFactorEnforcementGuard**.

## Configuration

Copy `.env.example` to `.env` and adjust values. The full canonical reference
lives in [`docs/environment-variables.md`](../../docs/environment-variables.md).

Environment variables are validated at boot (see `src/config/env.validation.ts`).
From Phase 1, the following are **required** and enforced at boot:
`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`
(secrets must be ≥16 chars). Optional additions include `APP_URL` (dashboard base
URL for email links; `DASHBOARD_URL` is an accepted fallback), `TWO_FACTOR_ISSUER`,
and the `SEED_*` variables used by `db:seed`.

## Health endpoints

```
GET /api/health        -> { status, service, version, uptime, timestamp }
GET /api/health/ready  -> { status, service, timestamp }
```

## Docker

The `Dockerfile` is a multi-stage pnpm-monorepo build. **Its build context is
the repository root** (so it can read `pnpm-workspace.yaml` and `packages/*`):

```yaml
api:
  build:
    context: .
    dockerfile: apps/api/Dockerfile
```

The image exposes port `3001` and ships a `HEALTHCHECK` hitting
`/api/health/ready` — deliberately NOT `/api/health`, which answers from
`process.uptime()` and never touches the database, so a container that had lost
its database connection reported healthy forever and the restart policy never
fired.

## Project structure

```
apps/api/
├── src/
│   ├── main.ts                 # bootstrap (prefix, helmet, CORS, pipes, swagger)
│   ├── app.module.ts           # root module (config, throttler, global guards)
│   ├── config/
│   │   ├── configuration.ts    # typed config factory
│   │   └── env.validation.ts   # class-validator env validation
│   ├── common/                 # crypto, password, tenant-context, guards, filters
│   └── modules/                # auth, users, sessions, invitations, two-factor,
│                               # companies, activity-log, mail, health
├── prisma/
│   ├── schema.prisma           # authoritative data model
│   └── migrations/             # init migration (20260614090000_init)
├── test/                       # e2e tests
└── Dockerfile
```
