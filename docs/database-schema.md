# Database Schema — Overview (Implemented)

> **Phase 1 — IMPLEMENTED.** The concrete, authoritative **Prisma schema now lives at
> `apps/api/prisma/schema.prisma`**, with the initial migration at
> `apps/api/prisma/migrations/20260614090000_init/migration.sql`. The
> **Identity / Auth / Tenancy** tables are live and wired to runtime modules; the
> remaining tables (fleet, content, scheduling, telemetry, billing, integration) exist in
> the schema but are **schema-only** until their respective phases. This document gives the
> entity overview; the Prisma schema is binding for exact names, fields, and types.

## Conventions

- Backing store: **Supabase Postgres** via **Prisma** (`DATABASE_URL` pooled,
  `DIRECT_URL` for migrations).
- **Tenant scoping:** every tenant-owned entity carries a non-null **`companyId`** and is
  always queried with it (see [multi-tenancy.md](./multi-tenancy.md)). Entities marked
  **[global]** are platform-level and not tenant-scoped.
- Timestamps (`createdAt`/`updatedAt`) and soft-delete/audit fields are present on most
  entities and omitted below for brevity.
- **Enums and relations match the Prisma schema** — including `UserRole`, `UserStatus`,
  `CompanyStatus`, `ScreenStatus`, `Orientation`, `ContentType`, `ContentStatus`,
  `SubscriptionStatus`, `InvoiceStatus`, `SchedulePriority`, and others. **White-label
  readiness** is provided by the `Reseller` model plus Company branding / `customDomain`
  columns.

## Core entities

### Identity, tenancy & access

| Entity                    | Purpose                                                                                             | Key relations                                           | Tenant scope                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| **Company**               | The tenant root; one customer organization.                                                         | has many Users, Locations, Content, Subscriptions…      | tenant root (`id` is the `companyId`)                    |
| **User**                  | A person who logs into the dashboard.                                                               | belongs to Company; has Role(s), Sessions, ActivityLogs | `companyId`                                              |
| **Role** / **Permission** | Role definitions and the capabilities they grant.                                                   | Users ↔ Role; Role ↔ Permission                         | `companyId` (custom roles); system roles **[global]**    |
| **Session**               | An active authenticated session (for inactivity timeout, active-sessions view, remote termination). | belongs to User                                         | `companyId`                                              |
| **Invitation**            | A pending invite to join a company (3-day expiry).                                                  | belongs to Company, optional target Role                | `companyId`                                              |
| **TwoFactor**             | A user's 2FA enrollment: TOTP secret + backup codes.                                                | belongs to User                                         | `companyId`                                              |
| **ActivityLog**           | Audit/login log of security- and tenant-significant actions.                                        | belongs to Company/User                                 | `companyId` (Super Admin platform actions also recorded) |

### Fleet hierarchy

| Entity          | Purpose                                                                    | Key relations                                                                             | Tenant scope |
| --------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------ |
| **Location**    | A physical site that owns screens.                                         | belongs to Company; has many Screens                                                      | `companyId`  |
| **Screen**      | A paired device/display at a location.                                     | belongs to Location; has Heartbeats, Screenshots, ProofOfPlay; assigned Playlist/Schedule | `companyId`  |
| **ScreenGroup** | A grouping of screens for bulk targeting (schedules/commands).             | belongs to Company; many-to-many Screen                                                   | `companyId`  |
| **Tag**         | A free-form label for screens/content/locations for filtering & targeting. | many-to-many with tagged entities                                                         | `companyId`  |
| **PairingCode** | A short-lived code that binds an unpaired device to a Screen.              | belongs to Company/Screen (on claim)                                                      | `companyId`  |

### Content & scheduling

| Entity                 | Purpose                                                                                                                             | Key relations                                                       | Tenant scope |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------ |
| **Content**            | A media asset (image/video/etc.) stored in Supabase Storage.                                                                        | belongs to Company; referenced by PlaylistItem                      | `companyId`  |
| **Playlist**           | An ordered collection of content played on screens.                                                                                 | belongs to Company; has many PlaylistItem                           | `companyId`  |
| **PlaylistItem**       | One entry in a playlist (content + duration/order/options).                                                                         | belongs to Playlist → Content                                       | `companyId`  |
| **Schedule**           | Time-window rules mapping playlists to screens/groups with a priority (Emergency > Higher Priority > Campaign > Normal > Fallback). | belongs to Company; targets Screen/ScreenGroup; references Playlist | `companyId`  |
| **EmergencyBroadcast** | A top-priority override pushed to a company/location/screen scope.                                                                  | belongs to Company; targets scope; references Content/Playlist      | `companyId`  |

### Telemetry & reporting

| Entity          | Purpose                                                                            | Key relations               | Tenant scope |
| --------------- | ---------------------------------------------------------------------------------- | --------------------------- | ------------ |
| **Heartbeat**   | Periodic device health/status ping (online status, current item, storage, errors). | belongs to Screen           | `companyId`  |
| **Screenshot**  | An on-demand or scheduled screen capture (stored in Storage).                      | belongs to Screen           | `companyId`  |
| **ProofOfPlay** | A record that a specific content item actually played (compliance/reporting).      | belongs to Screen → Content | `companyId`  |

### Billing (entities only; no payment gateway in v1)

| Entity           | Purpose                                     | Key relations                   | Tenant scope |
| ---------------- | ------------------------------------------- | ------------------------------- | ------------ |
| **Plan**         | A subscription plan/tier definition.        | referenced by Subscription      | **[global]** |
| **Subscription** | A company's active plan and limits.         | belongs to Company → Plan       | `companyId`  |
| **Invoice**      | A billing record for a subscription period. | belongs to Company/Subscription | `companyId`  |

### Platform & integration

| Entity              | Purpose                                                       | Key relations                                | Tenant scope               |
| ------------------- | ------------------------------------------------------------- | -------------------------------------------- | -------------------------- |
| **Notification**    | An in-app/email notification to a user.                       | belongs to Company/User                      | `companyId`                |
| **ApiKey**          | A scoped key for programmatic API access (future public API). | belongs to Company                           | `companyId`                |
| **Webhook**         | A subscriber endpoint for company events.                     | belongs to Company; has many WebhookDelivery | `companyId`                |
| **WebhookDelivery** | A single delivery attempt/result for a webhook event.         | belongs to Webhook                           | `companyId`                |
| **ApkVersion**      | A released Android player build (version, URL, rollout).      | global catalog of player releases            | **[global]**               |
| **Backup**          | Metadata for a database/storage backup run.                   | platform-level operational record            | **[global]** (operational) |

## Relationship summary

```
Company 1───* User           Company 1───* Location 1───* Screen
User    *───* Role *───* Permission       Screen *──* ScreenGroup
Screen  1───* Heartbeat / Screenshot / ProofOfPlay
Playlist 1──* PlaylistItem *──1 Content
Schedule *──> Playlist, targets Screen/ScreenGroup, has priority
EmergencyBroadcast ──> scope (Company/Location/Screen)
Company 1───1 Subscription ──> Plan;  Company 1───* Invoice
Company 1───* Webhook 1───* WebhookDelivery;  Company 1───* ApiKey
```

## Data-retention defaults

| Data                                      | Default retention                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| Logs (ActivityLog / login logs)           | **90 days**                                                                  |
| Proof-of-play records                     | **90 days**                                                                  |
| Screenshots                               | **90 days**                                                                  |
| Health/heartbeat telemetry                | **90 days**                                                                  |
| Alerts                                    | **90 days**                                                                  |
| Reports                                   | **90 days**                                                                  |
| **Financial records** (Invoice / billing) | **Longer** (per legal/compliance requirements; retained well beyond 90 days) |

Retention is enforced by scheduled cleanup jobs in a later phase. Defaults are
configurable per deployment/tenant where appropriate.

> **Reminder:** this overview is implemented as of **Phase 1**. The binding schema is the
> Prisma schema at `apps/api/prisma/schema.prisma` (with its init migration); in case of any
> discrepancy, the Prisma schema wins. Identity / Auth / Tenancy tables are live; the rest
> are schema-only pending their phases.

## Related docs

- [architecture.md](./architecture.md) · [multi-tenancy.md](./multi-tenancy.md) ·
  [security.md](./security.md) · [roadmap.md](./roadmap.md) ·
  [backup-restore.md](./backup-restore.md)
