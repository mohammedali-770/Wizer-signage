# MasterSignage

MasterSignage is a **multi-tenant digital signage SaaS platform** for **Android TV**.
It lets organizations manage screens, schedule playlists, and stream media to
networks of Android TV devices from a single, multi-tenant web dashboard.

> **Status: Phase 0 — Scaffold.** This repository currently contains the
> architecture, monorepo skeleton, tooling, and minimal runnable placeholders.
> Database schema, authentication, and product features land in later phases.
> See [docs/roadmap.md](docs/roadmap.md).

## Monorepo layout

```
master-signage/
├── apps/
│   ├── dashboard/          # Next.js 14 (App Router) admin dashboard — port 3000
│   ├── api/                # NestJS 10 REST + WebSocket API — port 3001
│   └── android-tv-player/  # Kotlin / Jetpack Compose Android TV player
├── packages/
│   ├── types/              # @master-signage/types  — shared TypeScript types/enums
│   ├── shared/             # @master-signage/shared — shared constants/utilities
│   └── ui/                 # @master-signage/ui     — shared React UI foundation
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
| Language       | TypeScript 5.4 (strict) · Kotlin 1.9                           |
| Dashboard      | Next.js 14 (App Router), React 18, Tailwind CSS 3.4, next-intl |
| API            | NestJS 10 (REST + WebSocket)                                   |
| Android        | Jetpack Compose, Media3 ExoPlayer (Android TV / leanback)      |
| Data & Storage | Supabase (PostgreSQL + Storage), Redis                         |
| Infra          | Docker Compose, Nginx reverse proxy, Let's Encrypt SSL         |

## Prerequisites

- **Node.js** >= 20 (see [`.nvmrc`](.nvmrc))
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

| App / Package            | Package name             | Dev URL / port            |
| ------------------------ | ------------------------ | ------------------------- |
| `apps/dashboard`         | (Next.js dashboard)      | http://localhost:3000     |
| `apps/api`               | (NestJS API)             | http://localhost:3001/api |
| `apps/android-tv-player` | (Android TV player)      | —                         |
| `packages/types`         | `@master-signage/types`  | —                         |
| `packages/shared`        | `@master-signage/shared` | —                         |
| `packages/ui`            | `@master-signage/ui`     | —                         |

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

Proprietary — © 2026 MasterSignage. All rights reserved. See [LICENSE](LICENSE).
