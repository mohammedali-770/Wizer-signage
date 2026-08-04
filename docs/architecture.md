# System Architecture

> **Phase 0 — Architecture plan.** This document describes the target architecture
> for Wizer Signage. Components are scaffolded in Phase 0; behavior is implemented in
> later phases (see [roadmap.md](./roadmap.md)).

## 1. Product summary

Wizer Signage is a **multi-tenant digital signage SaaS platform**. A company signs up,
registers physical **locations**, pairs **screens** (Android TV devices) to those
locations, uploads **content**, organizes it into **playlists**, and **schedules** what
plays where and when. Operators manage the fleet from a web dashboard and can push
**remote commands**, **emergency broadcasts**, and collect **proof-of-play** and health
telemetry from every device.

The platform is built for **strict tenant isolation** (every tenant's data is scoped by
`companyId`), **offline resilience** (players keep playing without a network), and
**near-real-time control** (commands reach devices on a short REST poll).

## 2. Components

| Component             | Technology                                                                             | Responsibility                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**         | Next.js 14 (App Router), React 18, TypeScript, Tailwind 3.4, next-intl v3, next-themes | Operator web UI. Bilingual (English LTR / Arabic RTL), light/dark themes. Talks to the API over REST.                                                                                                     |
| **API**               | NestJS 10, TypeScript                                                                  | REST API, business logic, authn/authz, tenant guards. Global prefix `api`. Reads `API_PORT` (default `3001`).                                                                                             |
| **Database**          | Prisma ORM + Supabase Postgres                                                         | System of record. Accessed via `DATABASE_URL` (pooled) and `DIRECT_URL` (migrations).                                                                                                                     |
| **Object storage**    | Supabase Storage                                                                       | Content media (images, video), screenshots, APK artifacts. Bucket via `SUPABASE_STORAGE_BUCKET`.                                                                                                          |
| **Device channel**    | HTTPS polling against the same REST API                                                | Players poll for the manifest and pending commands, and POST heartbeats + proof-of-play. **No WebSocket** — a poll survives NAT, captive portals, and long offline periods, which a held socket does not. |
| **Android TV player** | Kotlin 1.9, Jetpack Compose, Media3 ExoPlayer, AGP 8                                   | Native leanback app (`com.wizer.signage`). Plays content, pre-downloads media, reports telemetry.                                                                                                         |
| **Offline cache**     | On-device storage on the player                                                        | Pre-downloaded media + scheduled playlist so the screen keeps playing without connectivity.                                                                                                               |
| **Reverse proxy**     | Nginx                                                                                  | Routes `/` → dashboard, `/api` → API. Terminates SSL (Let's Encrypt), rate-limits at the edge.                                                                                                            |

External managed services: **Supabase** (Postgres + Storage). Production has **no local
database** — Postgres and Storage are Supabase. A dev Compose override may add a local
Postgres for offline development only (see [local-development.md](./local-development.md)).

## 3. High-level topology

```
                          Internet (HTTPS / WSS)
                                   |
                    +--------------v---------------+
                    |            Nginx             |   SSL termination (Let's Encrypt)
                    |   /  -> dashboard:3000        |
                    |   /api -> api:3001            |
                    +------+----------------+------+
                           |                |
              +------------v----+      +----v----------------+
              |   Dashboard     |      |       API           |
              |  Next.js :3000  | REST |   NestJS :3001      |
              |  (App Router)   +----->|  prefix /api        |
              +-----------------+      |                     |
                                       +----+-----------+----+
                                            |           |
                          DATABASE_URL /    |           |  Storage SDK
                          DIRECT_URL        |           |
                                  +---------v--+   +----v-----------+
                                  | Supabase   |   | Supabase       |
                                  | Postgres   |   | Storage bucket |
                                  +------------+   +----------------+

              HTTPS polling (manifest / commands / telemetry)
                  ^
                  |
        +---------+-----------+
        |  Android TV player  |  com.wizer.signage (Compose + Media3)
        |  + offline cache    |  pre-download, playback, telemetry
        +---------------------+
```

## 4. Core data flows

### 4.1 Pairing

```
Player boots (unpaired)
   -> POST /api/pairing/code            (device requests a pairing code)
   <- { code, expiresAt }               (short-lived code shown on the TV)
Operator enters code in dashboard, assigns it to a Location/Screen
   -> API binds device <-> Screen, issues device credentials
Player polls / receives "paired" over WS
   <- device token + initial config + assigned playlist/schedule
```

See [pairing-guide.md](./pairing-guide.md).

### 4.2 Content sync & pre-download

```
Schedule/playlist changes in dashboard
   -> API computes the effective plan for each affected Screen
   -> API notifies device over WS (or device polls REST on reconnect)
Player fetches the manifest (list of content + storage URLs + checksums)
   -> Player pre-downloads media to the offline cache BEFORE the play window
   -> Player verifies checksums, then atomically switches to the new plan
```

Pre-download guarantees a screen never shows a blank/loading state when a new schedule
activates, and that it keeps playing if the network drops.

### 4.3 Heartbeat

```
Player --(every interval, over WS; REST fallback if WS down)--> API
   payload: deviceId, status, currentItem, appVersion, storageFree, lastError, timestamp
API persists a Heartbeat row, updates "last seen", drives online/offline status.
```

### 4.4 Remote commands

```
Operator clicks an action (reboot, screenshot, clear cache, reload, identify)
   -> POST /api/screens/:id/commands
   -> API authorizes (role + tenant), enqueues command
   -> API pushes command over WS to the device (if online)
   <- Device executes and acknowledges; result stored (e.g. Screenshot row + storage URL)
If device offline: command queued; delivered on next reconnect.
```

### 4.5 Emergency broadcast

```
Operator triggers an Emergency Broadcast (company/location/screen scope)
   -> API marks an EmergencyBroadcast active for the target scope
   -> API fan-outs over WS to all targeted, online devices immediately
   -> Players interrupt the normal loop and show emergency content at top priority
On clear: API deactivates the broadcast; players resume the normal schedule.
```

### 4.6 Proof-of-play

```
Player records each actual play (contentId, screenId, startedAt, duration, completed)
   -> Buffers locally (survives offline)
   -> Batches to API: POST /api/proof-of-play (over REST)
API stores ProofOfPlay rows for reporting/compliance.
```

## 5. Request lifecycle (REST)

```
Client request
  -> Nginx (TLS, routing, WS upgrade)
  -> NestJS global prefix /api
  -> Global pipes (validation/whitelisting)
  -> Auth guard (JWT access token; device token for player routes)
  -> Tenant context guard (resolves companyId from the authenticated principal — never the body)
  -> Role/permission guard (capability check)
  -> Controller -> Service (business logic) -> Prisma (queries always companyId-scoped)
  -> Serialized DTO response (no cross-tenant leakage)
  -> Global exception filter (consistent error shape)
```

Tenant scoping is enforced in the service/data layer, not just the guard — see
[multi-tenancy.md](./multi-tenancy.md). Roles and capabilities are defined in
[security.md](./security.md).

## 6. Device channel

- **One channel: HTTPS polling.** The player polls `/api` for its manifest and for
  pending commands, and POSTs heartbeats and proof-of-play in batches. There is no
  WebSocket gateway — a poll survives NAT, captive portals, proxies, and long
  offline stretches, all of which a held socket does not, and a signage screen has
  no interaction latency budget that a short poll cannot meet.
- **Latency:** commands are picked up within one command-poll cycle (~12s). Content
  edits additionally push a `REFRESH_MANIFEST` command so a screen updates on that
  same cycle rather than waiting for the periodic manifest refresh.
- **Idempotency & ordering:** commands carry a unique id and are acknowledged; the
  device de-duplicates and the server treats unacknowledged commands as still
  pending. Proof-of-play is keyed on a device-generated session id, so a re-sent
  batch converges to the same rows.
- **Offline-first:** the player always operates against its **offline cache**. The
  network is an optimization for fresh content and control — not a runtime dependency.

## 7. Data hierarchy

```
Company (tenant)
  └── Location (physical site)
        └── Screen (a paired device / display)
              └── (plays) Playlist -> PlaylistItem -> Content
ScreenGroup and Tag provide cross-cutting grouping for targeting schedules and commands.
```

Every tenant-owned row carries `companyId`. See [database-schema.md](./database-schema.md).

## 8. Content & scheduling priority order

When deciding what a screen shows at any moment, the resolver evaluates candidates in
this strict priority order (highest wins):

```
1. Emergency        (active EmergencyBroadcast for this scope)
2. Higher Priority  (a schedule explicitly flagged high priority, within its time window)
3. Campaign         (a time-boxed campaign schedule, within its window)
4. Normal           (the default/recurring schedule for the screen)
5. Fallback         (default content shown when nothing else applies)
```

## 9. Fallback hierarchy

If no content resolves at a given level, the resolver walks **up** the hierarchy to find
fallback content:

```
Screen fallback  ->  Location fallback  ->  Company fallback
```

A screen always has _something_ to show: its own fallback, else its location's, else the
company's. This prevents blank screens during gaps or sync failures.

## 10. Scalability & statelessness

- The **API is stateless** — no session affinity. JWTs carry the principal; any instance
  can serve any REST request. This allows horizontal scaling behind Nginx.
- **WebSocket connections are sticky by nature** (a socket lives on one instance). At
  scale, a shared pub/sub (e.g. **Redis** via `REDIS_URL`) fans command/broadcast events
  out to whichever instance holds a given device's socket. Single-instance deployments
  work without Redis.
- **Heavy/long work is offloaded** from the request path (batched telemetry ingestion,
  media processing) so the API stays responsive.
- **Players absorb load spikes** via offline caching and batched/back-off uploads;
  control plane outages do not stop playback.
- Storage and the database are **managed Supabase services**, scaled independently of the
  app tier.

## 11. Tech stack table

| Layer            | Choice                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| Monorepo         | pnpm 9 workspaces + Turborepo                                            |
| Language         | TypeScript 5.4+ (strict); Kotlin 1.9 (player)                            |
| Dashboard        | Next.js 14 App Router, React 18, Tailwind 3.4, next-intl v3, next-themes |
| API              | NestJS 10                                                                |
| ORM              | Prisma                                                                   |
| Database         | Supabase Postgres                                                        |
| Object storage   | Supabase Storage                                                         |
| Realtime         | NestJS WebSocket gateway (+ Redis pub/sub at scale)                      |
| Player           | Kotlin, Jetpack Compose, Media3 ExoPlayer, Android TV (leanback)         |
| Reverse proxy    | Nginx (Let's Encrypt SSL)                                                |
| Containerization | Docker / Docker Compose                                                  |

## 12. Non-goals for v1

The following are explicitly **out of scope for v1** (may be reconsidered later):

- **No design editor** — no in-app canvas/template designer for creating media.
- **No dynamic menu builder** — no data-driven menu/price-board composition tool.
- **No payment gateway** — billing entities exist in the schema plan, but no online
  payment processing/checkout is implemented in v1.

## Related docs

- [multi-tenancy.md](./multi-tenancy.md) · [security.md](./security.md) ·
  [database-schema.md](./database-schema.md) · [roadmap.md](./roadmap.md) ·
  [android-player.md](./android-player.md) · [environment-variables.md](./environment-variables.md)
