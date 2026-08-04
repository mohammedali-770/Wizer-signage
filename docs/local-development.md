# Local Development Guide

This guide walks you through running the **Wizer Signage** monorepo on your machine.

The repo is a pnpm + Turborepo monorepo:

```
wizer-signage/
  apps/
    dashboard/         # Next.js 14 (App Router) — port 3000
    api/               # NestJS 11 — port 3001, routes under /api
    android-tv-player/ # Kotlin / Jetpack Compose Android TV app
  packages/
    types/             # @wizer/types  — shared TS types/enums
    shared/            # @wizer/shared — shared constants/utilities
    ui/                # @wizer/ui     — shared React UI foundation
  infra/{docker,nginx}/
  scripts/
  docs/
```

Internal packages are consumed as **TypeScript source** (no build step) and are referenced
with `workspace:*`.

---

## 1. Prerequisites

| Tool                 | Version       | Notes                                                                                    |
| -------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| **Node.js**          | `>= 20` (LTS) | Install via [nvm](https://github.com/nvm-sh/nvm) (`nvm install 20 && nvm use 20`).       |
| **pnpm**             | `9.x`         | Enable via Corepack: `corepack enable && corepack prepare pnpm@9 --activate`.            |
| **Git**              | latest        | For cloning and version control.                                                         |
| **Docker + Compose** | optional      | Only needed for the optional local Postgres and for testing the production-like stack.   |
| **JDK**              | `17`          | Required only to build/run the Android TV player.                                        |
| **Android Studio**   | latest stable | Required only for the Android TV player (Gradle 8 / AGP 8, leanback emulator or device). |

> **Windows users:** run the project's shell scripts (`scripts/*.sh`) from **Git Bash** or
> **WSL**. PowerShell/cmd cannot execute the `.sh` runbooks. `pnpm` commands work in any
> shell.

Verify your toolchain:

```bash
node -v      # v20.x
pnpm -v      # 9.x
git --version
```

---

## 2. Clone the repository

```bash
git clone <repository-url> wizer-signage
cd wizer-signage
```

---

## 3. Install dependencies

From the repo root (pnpm installs the entire workspace and links internal packages):

```bash
pnpm install
```

> The Android app is **not** part of the pnpm workspace — it is built with Gradle from
> `apps/android-tv-player`. See [android-player.md](./android-player.md).

---

## 4. Configure environment

Copy the template and fill in your values:

```bash
cp .env.example .env
```

At minimum, set your **Supabase** values so the API can connect to the database and
storage:

- `DATABASE_URL`, `DIRECT_URL`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`

Then set local-friendly networking defaults (already provided as examples in
`.env.example`):

```dotenv
NODE_ENV=development
API_PORT=3001
DASHBOARD_PORT=3000
API_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001/api
CORS_ORIGINS=http://localhost:3000
```

JWT secrets can be any long random strings locally:

```bash
# generate a random secret
openssl rand -base64 48
```

See [environment-variables.md](./environment-variables.md) for the full reference of every
variable and which service consumes it. **Never commit `.env`.**

---

## 5. Run the apps

### Everything at once (recommended)

Turborepo runs all `dev` tasks across the workspace in parallel:

```bash
pnpm dev
```

### Individual apps

Use pnpm filters to run a single app:

```bash
pnpm --filter @wizer/dashboard dev   # Next.js dashboard
pnpm --filter @wizer/api dev         # NestJS API
```

### Ports & key URLs

| Service   | URL                                      | Notes                                                        |
| --------- | ---------------------------------------- | ------------------------------------------------------------ |
| Dashboard | `http://localhost:3000`                  | Next.js App Router (en/ar, light/dark).                      |
| API       | `http://localhost:3001/api`              | All routes are under the global `/api` prefix.               |
| Health    | `http://localhost:3001/api/health`       | `{ status: "ok", service, version, uptime, timestamp }`.     |
| Readiness | `http://localhost:3001/api/health/ready` | Readiness probe.                                             |
| API docs  | `http://localhost:3001/api/docs`         | Swagger UI (planned — see [api-future.md](./api-future.md)). |

Quick smoke test:

```bash
curl http://localhost:3001/api/health
```

---

## 6. Optional: local Postgres (offline development)

Production uses **Supabase** and has no local database. For fully offline work you can run
a throwaway local Postgres via the dev override:

```bash
docker compose \
  -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.dev.yml \
  up -d postgres
```

Then point `DATABASE_URL` / `DIRECT_URL` at the local instance in your `.env`. This is for
development only — it is not used in production.

---

## 7. Lint, typecheck & format

Turborepo wires these tasks across all packages:

```bash
pnpm lint        # ESLint across the workspace
pnpm typecheck   # tsc --noEmit across the workspace
pnpm format      # Prettier write (if configured)
pnpm build       # production build (apps) — usually not needed for daily dev
```

Run for a single package with a filter, e.g.:

```bash
pnpm --filter @wizer/api typecheck
```

---

## 8. Android TV player (optional)

The Android app lives outside the pnpm workspace:

1. Open `apps/android-tv-player` in **Android Studio**.
2. Let Gradle sync (version catalog in `gradle/libs.versions.toml`).
3. Run on an **Android TV (leanback)** emulator or device (minSdk 21, targetSdk 34).

Details and pairing flow: [android-player.md](./android-player.md) and
[pairing-guide.md](./pairing-guide.md).

---

## 9. Troubleshooting

| Symptom                                   | Likely cause / fix                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm: command not found`                 | Run `corepack enable` then `corepack prepare pnpm@9 --activate`.                            |
| Wrong Node version                        | `nvm use 20`. Confirm with `node -v`.                                                       |
| `EADDRINUSE` on 3000/3001                 | Another process holds the port. Stop it, or change `DASHBOARD_PORT` / `API_PORT` in `.env`. |
| API cannot reach the database             | Verify `DATABASE_URL` / `DIRECT_URL` and that your IP is allowed in the Supabase project.   |
| CORS errors in the browser                | Add your dashboard origin to `CORS_ORIGINS` and restart the API.                            |
| `NEXT_PUBLIC_API_URL` changes not applied | Public env vars are inlined at build/start — restart the dashboard dev server.              |
| Workspace package not resolving           | Re-run `pnpm install`; ensure the dependency uses `workspace:*`.                            |
| `.sh` scripts fail on Windows             | Use **Git Bash** or **WSL**, not PowerShell/cmd.                                            |
| Stale Turbo cache                         | Re-run with `pnpm dev --force` or clear `.turbo/`.                                          |

---

## Related documentation

- [environment-variables.md](./environment-variables.md) — every env var explained
- [architecture.md](./architecture.md) — system overview
- [production-deployment.md](./production-deployment.md) — deploying to a server
- [android-player.md](./android-player.md) — Android TV app
