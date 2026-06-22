# Company Management Guide (Phase 3)

> **Implemented in Phase 3.** Each company manages its own operational structure —
> locations/branches, screens, screen groups, tags, map view, working hours, audio,
> kiosk/device settings, and company settings — within strict tenant isolation. Builds on
> Phase 1 (auth/tenancy/RBAC) and Phase 2 (usage limits / grace period). Content library,
> playlists, schedules, real pairing, heartbeats, and the Android player come in later phases.

## 1. The Company Admin console

A dedicated, company-scoped area at `/{locale}/company` (separate from the Super Admin
`/admin` console). After login the dashboard routes each user to the right area by role:
Super Admins → `/admin`, company users → `/company`.

Sidebar: **Overview, Locations, Screens, Screen Groups, Tags, Map View, Settings, Activity
Logs.** Everything is scoped to the signed-in user's company — `companyId` is always taken
from the verified token, never from the client.

### Roles (existing RBAC)

| Capability                     | Company Admin | Location Manager | Content Manager | Viewer |
| ------------------------------ | :-----------: | :--------------: | :-------------: | :----: |
| View locations/screens         |      ✅       |        ✅        |       ✅        |   ✅   |
| Manage locations               |      ✅       |  🔸 assigned\*   |       ❌        |   ❌   |
| Manage screens / groups / tags |      ✅       |        ✅        |       ❌        |   ❌   |
| Company settings               |      ✅       |        ❌        |       ❌        |   ❌   |

\*Location-level scoping for Location Managers is modelled (`UserLocation`) but not yet
enforced per-location in Phase 3 — the role-level guard applies. (Follow-up.)

## 2. Locations / branches

`GET/POST /api/locations`, `GET/PATCH /api/locations/:id`,
`POST /api/locations/:id/archive|deactivate|reactivate`, `DELETE /api/locations/:id`.

- Fields: name, code (unique per company), description, address, city, region, country,
  latitude/longitude, timezone, notes, **status** (ACTIVE / INACTIVE / ARCHIVED), working
  hours, and a fallback-content placeholder reference.
- Detail view shows **screen metrics** (total / online / offline / warning — online/offline
  populate when device heartbeats arrive in a later phase).
- Soft delete (`deletedAt` + ARCHIVED); deleting a location unassigns its screens (it does
  not delete them).
- **Usage limit:** creating a location enforces the plan's `maxLocations` via the Phase 2
  grace-period logic (warn → 7-day grace → block). Archived locations don't consume quota.

## 3. Screens

`GET/POST /api/screens`, `GET/PATCH /api/screens/:id`, `POST /api/screens/:id/move`,
`PUT /api/screens/:id/tags|groups|kiosk-pin`, `DELETE /api/screens/:id/kiosk-pin`,
`POST /api/screens/:id/archive|disable|reactivate`, `DELETE /api/screens/:id`,
`POST /api/screens/bulk/tags|groups`.

- Screen profiles are created **manually** (status `UNPAIRED`). Real Android pairing and
  heartbeat are later phases — Phase 3 only builds the management foundation and fields.
- Fields: name, code, description, location, **use** (Menu Landscape, Offers Portrait,
  Waiting Area, Cashier Display, Entrance, Indoor, Outdoor, Generic/Custom), **orientation**,
  **status** (UNPAIRED / PAIRING / ONLINE / OFFLINE / WARNING / DISABLED / ARCHIVED), tags,
  group memberships, audio (see §8), working hours (§7), kiosk/device (§9), fallback-content
  placeholder, and monitoring placeholders (last heartbeat/sync, app version, current
  content, storage) that populate in later phases.
- Filter the list by location, status, orientation, use, and tag. Move a screen between
  locations; assign/remove tags and groups individually or in bulk.
- **Usage limit:** creating a screen enforces the plan's `maxScreens` (same grace logic).
  Archived screens don't consume quota.

## 4. Screen groups

`GET/POST /api/screen-groups`, `GET/PATCH /api/screen-groups/:id`,
`POST|DELETE /api/screen-groups/:id/screens`, `DELETE /api/screen-groups/:id`.

Groups (name, description, category) collect screens for bulk targeting. Add/remove or bulk
members. Groups are the targeting unit that **playlists/schedules will reuse in later
phases** — the schema/API are prepared for that (`ScheduleTarget` / `ScreenGroup`).

## 5. Tags

`GET/POST /api/tags`, `PATCH /api/tags/:id`, `DELETE /api/tags/:id`.

Company-scoped tags (name, **type** SCREEN / CONTENT / BOTH, color, description) organize
screens now and **content in Phase 4** (same tag system, reused). Filter screens by tag;
assign individually or in bulk.

## 6. Map view foundation

Locations store latitude/longitude. The Map View page renders locations with **status
colors** (Online / Offline / Warning / Unknown). Since heartbeats aren't implemented yet,
status is **derived** from the location/screen status fields (mostly "Unknown"). Clicking a
location opens its detail (its screens).

The map provider is intentionally **flexible**: configure `NEXT_PUBLIC_MAP_PROVIDER` (+ a map
API key) to enable an interactive provider later. With no provider configured the page falls
back to a coordinate list with external map links — no map dependency is required in v1.

## 7. Working hours / active hours

Configurable at company (default), location, and screen levels. Supports per-day open/close
times, closed-all-day, **overnight ranges** (close < open), and a timezone (defaults to the
entity's own). Outside-active-hours behaviour: **Show fallback content / Black screen /
Custom message / Attempt sleep**. Phase 3 is **configuration only** — devices apply working
hours in a later phase.

## 8. Audio settings (per screen)

Audio enabled/disabled, **volume 0–100** (validated), default-video-muted, and a mute-schedule
placeholder. Actual Android volume control arrives later.

## 9. Kiosk / device settings foundation

Kiosk mode enabled, **company default kiosk PIN** and **per-screen PIN override**, auto-start
expected flag, power-control desired behaviour, and capability placeholders. **PINs are stored
as Argon2 hashes — never raw, never returned** — with set/reset flows
(`PUT|DELETE /api/screens/:id/kiosk-pin` and `/api/company-settings/kiosk-pin`). Android
behaviour (kiosk lock, auto-start, power) is a later phase.

## 10. Company settings

`GET/PATCH /api/company-settings`, `PUT|DELETE /api/company-settings/kiosk-pin`,
`GET /api/company-settings/usage`.

Company Admins edit: display name, default locale/timezone, default working hours, default
heartbeat interval, notification emails, default fallback-content placeholder, and the default
kiosk PIN. The current **plan/subscription is shown read-only** (billing is managed by the
Super Admin). `/usage` returns the company's usage vs plan limits with grace status.

## 11. Activity logs

Every Phase 3 action is audited (category `COMPANY`): location created/updated/archived/
reactivated/deleted; screen created/updated/archived/disabled/reactivated/moved; screen
group created/updated/deleted and screens added/removed; tag created/updated/deleted; screen
tags/groups assigned; working-hours/audio/fallback changes (captured in update metadata);
kiosk PIN changed/reset; company settings changed; plus usage grace-period start/end (Phase
2). Company Admins see only their company's logs (`GET /api/activity-logs`).

## 12. How to test Phase 3

1. Run the stack (see [local-development.md](./local-development.md)); migrate + seed; sign
   in as the seeded **Company Admin** (`admin@<company-slug>.local`). You'll land on
   `/en/company`.
2. **Locations:** create a location (with coordinates + working hours), edit it, archive and
   reactivate it. Check the Overview/usage counters update.
3. **Screens:** create a screen (pick location, use, orientation, audio, kiosk PIN). Verify
   the PIN is accepted but never shown back (only "PIN set"). Move it to another location;
   assign tags/groups; archive/reactivate.
4. **Groups & tags:** create a group and a tag; add screens to the group; filter the screens
   list by tag and by group.
5. **Map View:** confirm locations with coordinates appear with status dots and map links.
6. **Settings:** change the company timezone + default working hours; set then clear the
   default kiosk PIN.
7. **Usage/limits:** with a low plan limit (set via the Super Admin console), create
   locations/screens past the limit — the first overage opens a 7-day grace period; after it
   elapses, creation is blocked (existing resources are untouched).
8. **Tenant isolation:** a second company's Company Admin must never see the first company's
   locations/screens (every `:id` fetch is company-scoped → 404 across tenants).
9. **Automated tests:** `pnpm --filter @master-signage/api test` covers company scoping,
   location/screen usage-limit enforcement, archive/reactivate, tag/group assignment, volume
   validation, kiosk-PIN-not-raw, and audit logging.

## Related docs

- [super-admin-guide.md](./super-admin-guide.md) · [security.md](./security.md) ·
  [multi-tenancy.md](./multi-tenancy.md) · [database-schema.md](./database-schema.md) ·
  [roadmap.md](./roadmap.md) · [device-limitations.md](./device-limitations.md)
