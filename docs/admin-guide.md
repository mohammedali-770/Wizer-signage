# Administrator Guide (Foundation)

This guide orients dashboard administrators to MasterSignage: who can do what,
and where each capability lives. The platform is delivered in phases, so each
area below is tagged with the phase it arrives in — areas marked for a later
phase are not yet available. Consult [roadmap.md](./roadmap.md) for the
authoritative schedule.

This is the foundational version of the guide; per-area detail is expanded as
each feature ships.

---

## Role hierarchy

MasterSignage is multi-tenant: a **Super Admin** operates the whole platform,
while every other role works inside a single **company** (tenant). See
[multi-tenancy.md](./multi-tenancy.md) and [security.md](./security.md) for how
scoping and permissions are enforced.

| Role                  | Scope            | Can do                                                                                                                                                                                                                       |
| --------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Super Admin**       | Entire platform  | Create/manage companies, set plans & usage limits, suspend/reactivate companies, manage the player's required minimum version & APK updates, view cross-tenant activity. Does **not** manage day-to-day content for tenants. |
| **Company Admin**     | One company      | Full control within their company: users, locations, screens, content, playlists, schedules, billing view, settings.                                                                                                         |
| **Manager**           | Company / subset | Manage content, playlists, schedules, and screens for their assigned locations/groups. Cannot manage billing or company-wide users.                                                                                          |
| **Operator / Editor** | Assigned scope   | Upload content, build playlists, and schedule — within assigned locations. No destructive/admin actions.                                                                                                                     |
| **Viewer**            | Read-only        | View screens, monitoring, and reports. No changes.                                                                                                                                                                           |

Exact permission grants per role are defined in [security.md](./security.md);
roles arrive with the auth foundation in **Phase 2**.

---

## Areas of the dashboard

Each area lists the **phase** it arrives in. Items in later phases are
placeholders today.

### Companies — Super Admin _(Phase 1-2)_

Create and manage tenant companies, assign a Company Admin, set the plan and
usage limits, and suspend/reactivate. This is the only area scoped to the whole
platform; everything below is scoped to a single company.

### Locations / Branches _(Phase 3)_

Model the company's physical sites (branch, store, office). Locations group
screens geographically and drive scoping for managers and content targeting.

### Screens & pairing _(Phase 6)_

Add screens by pairing physical devices (see
[pairing-guide.md](./pairing-guide.md)), name them, assign them to a location,
and unpair/re-pair as hardware changes. Each screen shows its online status and
assigned content.

### Screen Groups & Tags _(Phase 6)_

Organize screens into groups and apply tags so content and schedules can target
many screens at once (e.g. "all drive-thru menus", "lobby screens").

### Content Library _(Phase 4)_

Upload and manage media (images, video). Preview assets, tag them, set expiry
dates, and move items to trash or archive. Storage is backed by Supabase
Storage. Expired and trashed items are handled without breaking active
playlists.

### Playlists _(Phase 5)_

Order content into playlists, set per-item durations and transitions, and assign
playlists to screens or groups. Playlists are the unit screens actually play.

### Advanced Scheduling & priority _(Phase 7)_

Schedule what plays when (dayparting, date ranges, recurring rules) and resolve
conflicts via priority so the highest-priority valid schedule wins on each
screen.

### Emergency Broadcast _(Phase 7)_

Instantly override normal playback across selected screens/groups with an urgent
message, then revert cleanly when cleared. Higher priority than all regular
schedules.

### Monitoring — heartbeat, screenshots, map _(Phase 8)_

See which screens are online via heartbeat, view recent screenshots of what each
is actually showing, and locate screens on a map (provider configured via
`MAP_PROVIDER` / `MAP_API_KEY`).

### Remote actions _(Phase 8)_

Trigger device commands from the dashboard: refresh content, restart playback,
clear cache, capture a screenshot, or reboot — subject to device capability
(see [device-limitations.md](./device-limitations.md)).

### Proof-of-Play & reports / exports _(Phase 8)_

Verify what played, where, and when. Generate reports and export them
(e.g. CSV/Excel) for clients, compliance, or advertising proof-of-play.

### Notifications & alerts _(Phase 8)_

Get notified when a screen goes offline, storage runs low, content expires, or a
device reports an unsupported capability. Delivery includes in-app and email
(SMTP).

### Import (Excel / CSV) _(Phase 9)_

Bulk-create entities (e.g. locations, screens) by importing a spreadsheet,
speeding up onboarding of large fleets.

### Billing — subscriptions, plans, usage limits, grace period _(Phase 10)_

View the company's plan and subscription, track usage against limits (screens,
storage, users), and understand the grace-period behavior when limits are
exceeded or payment lapses. Plans and limits are set by the Super Admin.

### Suspend / reactivate company — Super Admin _(Phase 10)_

Suspend a company (e.g. for non-payment) to freeze its screens, then reactivate
to restore service. Suspension respects the configured grace period.

### Activity logs _(Phase 2+, expanded over time)_

A searchable audit trail of who did what and when — pairing, content changes,
schedule edits, remote actions, billing changes. Foundational logging arrives
with auth; coverage broadens as each area ships.

---

## Quick navigation summary

| Area                           | Audience          | Phase |
| ------------------------------ | ----------------- | ----- |
| Companies                      | Super Admin       | 1-2   |
| Locations / Branches           | Company Admin/Mgr | 3     |
| Content Library                | Operator+         | 4     |
| Playlists                      | Operator+         | 5     |
| Screens & pairing              | Company Admin/Mgr | 6     |
| Screen Groups & Tags           | Company Admin/Mgr | 6     |
| Advanced Scheduling & priority | Manager+          | 7     |
| Emergency Broadcast            | Manager+          | 7     |
| Monitoring / screenshots / map | Viewer+           | 8     |
| Remote actions                 | Manager+          | 8     |
| Proof-of-Play & reports        | Viewer+           | 8     |
| Notifications & alerts         | Viewer+           | 8     |
| Import (Excel/CSV)             | Company Admin     | 9     |
| Billing & subscriptions        | Company Admin     | 10    |
| Suspend / reactivate company   | Super Admin       | 10    |
| Activity logs                  | Company Admin+    | 2+    |

---

## Related documentation

- [roadmap.md](./roadmap.md) — phase-by-phase delivery plan.
- [security.md](./security.md) — roles and permissions in detail.
- [multi-tenancy.md](./multi-tenancy.md) — tenant scoping model.
- [pairing-guide.md](./pairing-guide.md) — adding screens.
- [device-limitations.md](./device-limitations.md) — what remote actions can do.
