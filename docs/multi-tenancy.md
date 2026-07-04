# Multi-Tenancy

> **Phase 0 — Plan.** This document defines the tenant-isolation strategy that all
> backend code must follow. The guards and query patterns described here are implemented
> starting in the auth/tenant phases (see [roadmap.md](./roadmap.md)); the rules
> themselves are binding from day one.

## 1. Tenancy model

Wizer Signage uses a **shared-database, shared-schema** multi-tenant model with a single
Supabase Postgres instance. Tenants are **companies**. Every tenant-owned row carries a
`companyId` foreign key, and every query is scoped by it. This is simpler to operate than
schema-per-tenant or database-per-tenant while remaining strongly isolated when the rules
below are enforced consistently.

The tenant is a `Company`. Its data hierarchy:

```
Company (tenant root)
  └── Location
        └── Screen
              └── Playlist / Schedule / Content / Heartbeat / ProofOfPlay ...
Users, Roles, Sessions, Invitations, ActivityLogs, billing, etc. also belong to a Company.
```

## 2. `companyId` scoping on every tenant table

- **Every tenant-owned table includes a non-null `companyId`** column referencing
  `Company`. The only rows without `companyId` are global/system tables (e.g. platform
  `Plan` definitions, `ApkVersion`) and the Super Admin's cross-tenant constructs.
- `companyId` participates in indexes so tenant-scoped queries stay fast.
- Foreign keys never cross tenant boundaries: a `Screen.locationId` must reference a
  `Location` in the **same** `companyId`. These invariants are enforced in the service
  layer and reinforced by checks/constraints where practical.

See the entity list in [database-schema.md](./database-schema.md).

## 3. Request-scoped tenant context (NestJS)

The API resolves a **tenant context** once per request and makes it available to the rest
of the request via a request-scoped provider / `AsyncLocalStorage`:

```
Authenticated principal (from JWT or device token)
   -> Auth guard validates the token, attaches the principal
   -> TenantContextGuard derives companyId FROM THE PRINCIPAL (token claims / device binding)
   -> A request-scoped TenantContext { companyId, userId, role } is populated
   -> Services read companyId from TenantContext, never from the HTTP body/query/params
```

Pattern:

- A `@CurrentTenant()` decorator / `TenantContext` service exposes the resolved
  `companyId` to controllers and services.
- A **`TenantGuard`** runs after authentication and refuses any request whose principal
  has no company (except Super Admin routes, see §6).
- Player/device routes derive `companyId` from the **device's pairing binding**, not from
  any client-supplied field.

## 4. "Never trust `company_id` from the client" — the golden rule

> The client (dashboard or device) **never** dictates which tenant it is acting on.

- `companyId` is **always** taken from the verified token/principal, **never** from the
  request body, query string, route param, or header.
- If a payload contains a `companyId`/`company_id` field, it is **ignored** (and stripped
  by DTO whitelisting). A mismatch between a client-supplied value and the principal's
  tenant is treated as a potential attack and rejected/logged.
- Resource IDs in the URL (e.g. `/api/screens/:id`) are **re-validated** against the
  caller's `companyId` — fetching by id alone is never sufficient; the row must belong to
  the caller's tenant or the request returns 404 (not 403, to avoid confirming existence).

## 5. Query-level enforcement

Tenant scoping is enforced **at the data-access layer**, not only in guards, so a missing
guard can never silently leak data:

- A shared **scoped Prisma helper / repository** injects `where: { companyId }` into every
  tenant-table read, update, and delete. Direct unscoped Prisma access on tenant tables is
  disallowed by convention and code review.
- **Writes** stamp `companyId` from the `TenantContext`; they never accept it from input.
- **Updates/deletes** include `companyId` in the `where` clause so a guessed id from
  another tenant affects zero rows.
- **Aggregations/reports** filter by `companyId` at the database level.
- Optional defense-in-depth: Postgres **Row-Level Security** policies can be layered on
  later for tenant tables; the application-layer scoping is the primary guarantee in v1.

## 6. Super Admin cross-tenant access

- **Super Admin** is a platform-level role that may operate across tenants (support,
  provisioning, incident response). Super Admin requests bypass the single-tenant
  `companyId` requirement but go through a **dedicated, audited path**:
  - Cross-tenant actions require an **explicit target `companyId`** chosen by the Super
    Admin and are **recorded in the ActivityLog** (who, which tenant, what action).
  - Super Admin accounts require **2FA** (see [security.md](./security.md)).
  - Regular (non-super) roles can **never** widen their scope to another tenant by any
    input — the cross-tenant capability is gated on the role itself, server-side.

## 7. Future-ready: white-label, resellers & partners

These are **designed-for but not active in v1**. The schema and tenant model leave room
to add them without re-architecting:

- **Reseller / partner accounts** — an account type that owns/manages a set of child
  companies (a tenant-of-tenants hierarchy). The `Company` model is structured so a parent
  relationship and partner-scoped roles can be introduced later.
- **White-label tenants** — per-company branding so the product can be re-skinned:
  - **Custom domains** — map a partner/customer domain to a specific tenant (Nginx +
    tenant resolution by host). Reserved for future; v1 resolves tenant from the principal.
  - **Branded emails** — per-tenant `SMTP_FROM`, sender name, and templates layered over
    the platform defaults (`SMTP_*` env vars).
  - **Custom logo & colors** — per-tenant theme tokens (logo, primary/accent colors)
    consumed by the dashboard theming layer.
- These features will reuse the same `companyId` scoping rules; branding/domain config
  attaches to the `Company` (or a future `Brand`/`Partner` entity) and never relaxes data
  isolation.

## Related docs

- [architecture.md](./architecture.md) · [security.md](./security.md) ·
  [database-schema.md](./database-schema.md) · [roadmap.md](./roadmap.md)
