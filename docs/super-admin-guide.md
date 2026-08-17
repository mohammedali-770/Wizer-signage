# Super Admin Guide (Phase 2 — SaaS Core)

> **Implemented in Phase 2.** The platform owner ("Super Admin") manages companies, other
> Super Admins, plans, subscriptions, invoices, usage limits, grace periods, and company
> suspension. No payment gateway is integrated in v1 (subscriptions/invoices are managed
> manually). Builds on the Phase 1 auth/tenancy/RBAC foundation — see
> [security.md](./security.md) and [multi-tenancy.md](./multi-tenancy.md).

## 1. Access & the console

The Super Admin console lives in the dashboard at `/{locale}/admin` (e.g. `/en/admin`).

- Every `/admin/*` route and every Phase 2 management endpoint is **Super Admin only**
  (enforced server-side by the role guard; the dashboard also redirects non-admins).
- **2FA is mandatory for Super Admins.** On first login the console forces TOTP enrolment
  (QR + authenticator code) and issues one-time backup codes before granting access.
- Sidebar: **Overview, Companies, Plans, Subscriptions, Invoices, Super Admins, System
  Settings, Activity Logs.**

## 2. Companies

Full CRUD plus lifecycle control:

| Action                    | Endpoint                             | Notes                                                                                                                      |
| ------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| List (search/filter/sort) | `GET /api/companies`                 | `?search&status&sort&order&page&pageSize`; returns per-row metrics (users/locations/screens) and the current subscription. |
| Create                    | `POST /api/companies`                | Optional `planId` creates a trialing subscription. Slug auto-generated and de-duplicated.                                  |
| Detail + metrics          | `GET /api/companies/:id`             | Returns `{ company, subscription, usage }`.                                                                                |
| Usage                     | `GET /api/companies/:id/usage`       | Usage vs plan limits + grace status.                                                                                       |
| Update                    | `PATCH /api/companies/:id`           | Name, locale, timezone, branding, custom domain, kiosk PIN.                                                                |
| Suspend                   | `POST /api/companies/:id/suspend`    | Optional `{ reason }`.                                                                                                     |
| Reactivate                | `POST /api/companies/:id/reactivate` |                                                                                                                            |

**Company status** shown in the UI combines the company record (`ACTIVE`, `SUSPENDED`,
`PENDING`, `CANCELLED`) with the subscription status (`TRIALING`, `EXPIRED`, …).

### Company suspension behaviour (important)

When a company is suspended (`status = SUSPENDED`):

- **Its users are blocked from the dashboard immediately** — all of the company's active
  sessions are revoked, and the JWT strategy rejects further requests for a suspended
  company (so re-login is also blocked).
- **Existing data is preserved** — suspension is a status change, never a delete.
- Screens **stop receiving new content** and fall back to normal company fallback
  content. Both halves ship: the backend status drives it and the Android player
  acts on the resulting manifest.
- **Reactivation** restores access (`status = ACTIVE`, suspension metadata cleared).

All of the above is recorded in the Activity Log.

## 3. Super Admins (multiple platform admins)

| Action     | Endpoint                                                 |
| ---------- | -------------------------------------------------------- |
| List       | `GET /api/super-admin/admins`                            |
| Invite     | `POST /api/super-admin/admins/invite` `{ email, name? }` |
| Activate   | `POST /api/super-admin/admins/:id/activate`              |
| Deactivate | `POST /api/super-admin/admins/:id/deactivate`            |

- New Super Admins join via the standard **invitation** flow (3-day, single-use link) and
  must enrol 2FA on first login.
- **Last-active-Super-Admin protection:** any operation that would leave zero active Super
  Admins (deactivate, delete, demote, lockout) is rejected. A lockout never disables the
  last active Super Admin.

## 4. Plans

`GET/POST /api/plans`, `GET/PATCH /api/plans/:id`, `POST /api/plans/:id/archive|activate`.

Plan fields: name, code (unique, immutable), description, **`priceMonthly`** (required,
defaults to 0) and optional **`priceYearly`** + currency + `billingInterval`
(MONTHLY/QUARTERLY/YEARLY), trial days, active/public flags, and a typed **limits**
object (stored as JSON; `null`/omitted = unlimited). There is no field called `price`;
it was renamed to `priceMonthly` so a plan round-trips by copying fields. Money is a
**string** on every response — parse before doing arithmetic:

`maxCompanies` (reseller-ready), `maxLocations`, `maxScreens`, `maxUsers`, `storageGb`,
`maxFileSizeMb`, `autoScreenshotsPerDay`, `scheduledReports`, `dataRetentionDays`,
`apiRequestsPerDay` (future), `webhooks` (future).

## 5. Subscriptions (manual)

`GET/POST /api/subscriptions`, `GET/PATCH /api/subscriptions/:id`,
`POST /api/subscriptions/:id/cancel`, `GET /api/subscriptions/:id/history`.

- One subscription per company. Create assigns a plan and a status; trialing subscriptions
  get a `trialEndsAt` from the plan's trial days (or an explicit `trialDays`).
- Statuses: **ACTIVE, TRIALING, EXPIRED, SUSPENDED, CANCELLED.** Plan changes, status
  changes, period dates, and cancellation are all manual Super Admin actions.
- **History** is reconstructed from the Activity Log (every change is audited).
- Changing the plan triggers a **grace-period reconcile** (see below).

## 6. Invoices (foundation, no gateway)

`GET/POST /api/invoices`, `GET /api/invoices/:id`, `PATCH /api/invoices/:id/status`.

- Manual invoices linked to a company (and optionally a subscription). Line items
  (`description`, `quantity`, `unitPrice`) drive the computed `subtotal`/`total` (+ optional
  tax). Numbers are sequential and year-scoped (`INV-YYYY-NNNNN`).
- Statuses: **DRAFT, UNPAID, PAID, OVERDUE, CANCELLED** (marking PAID stamps `paidAt`).
- The data model is structured for a future **Stripe / Moyasar / HyperPay** integration.
- Invoices are a first-class export dataset — CSV, XLSX and print-ready HTML via
  `GET /exports/invoices`. (A true server-side PDF renderer remains a future
  enhancement; the print-HTML view is what produces PDFs today.)

## 7. Usage limits & grace period

`UsageLimitsService` computes live usage (locations, screens, users, storage) and compares
it to the company's plan limits.

- **Approaching:** a resource at ≥ 80% of its limit is flagged (warning).
- **Exceeded → grace:** the first time an add would exceed a limit, a **7-day grace period**
  starts (`Subscription.gracePeriodEndsAt`) and the add is allowed (temporary usage). Both
  Company Admin and Super Admin can see this on the company detail / usage view.
- **After grace:** once the grace window elapses, adding **new** resources above the limit is
  **blocked** — but existing resources/screens are never stopped abruptly.
- **Reconcile:** raising the plan (or otherwise bringing usage back within limits) clears the
  grace period. Grace start/end events are logged.
- Enforcement is wired at resource-creation points; in Phase 2 the user limit is enforced on
  invitations. Location/screen/content/storage enforcement attaches as those features ship
  (Phases 3–4). Super Admin can always adjust the subscription/plan manually.

## 8. Activity logs

Every important Phase 2 action is written to the audit trail (categories `COMPANY`,
`PLAN`, `SUBSCRIPTION`, `INVOICE`, `BILLING`, `USAGE`, `SECURITY`): company
created/updated/suspended/reactivated; plan created/updated/archived/activated; subscription
created/updated/cancelled; invoice created/status-changed; Super Admin invited/activated/
deactivated; usage grace-period started/ended. Browse them under **Activity Logs**
(`GET /api/activity-logs`, Super Admin sees all tenants).

## 9. API endpoint overview (Phase 2)

All under the `/api` prefix and require a Super Admin bearer token (2FA-satisfied):

```
GET  /api/super-admin/overview
GET  /api/super-admin/admins            POST /api/super-admin/admins/invite
POST /api/super-admin/admins/:id/activate | /deactivate
GET/POST /api/companies                 GET /api/companies/:id   GET /api/companies/:id/usage
PATCH /api/companies/:id                POST /api/companies/:id/suspend | /reactivate
GET/POST /api/plans                     GET/PATCH /api/plans/:id  POST /api/plans/:id/archive|activate
GET/POST /api/subscriptions             GET/PATCH /api/subscriptions/:id
POST /api/subscriptions/:id/cancel      GET /api/subscriptions/:id/history
GET/POST /api/invoices                  GET /api/invoices/:id     PATCH /api/invoices/:id/status
GET  /api/activity-logs
```

Full request/response schemas are in Swagger at **`/api/docs`**.

## 10. How to test Phase 2

1. **Run the stack** (see [local-development.md](./local-development.md)): apply migrations,
   `pnpm --filter @wizer/api db:seed`, then start the API and dashboard.
2. **Sign in** at `/en/login` with the seeded Super Admin. On first login, **enrol 2FA**
   (scan the QR with an authenticator app, enter the code, save the backup codes).
3. **Overview** should show company/subscription/plan/invoice/user counters.
4. **Plans:** create a plan with small limits (e.g. `maxUsers: 2`). Archive/activate it.
5. **Companies:** create a company (assign the plan). Open its detail — metrics + usage show.
   **Suspend** it (with a reason) and confirm a logged-in user of that company is blocked on
   their next request; **reactivate** to restore.
6. **Subscriptions:** create/change a subscription; cancel one; view its history.
7. **Invoices:** create a manual invoice with line items; flip its status to Paid.
8. **Usage/grace:** with `maxUsers: 2`, invite users past the limit — the first overage
   starts a grace period (visible on the company usage view and logged); after the grace
   period adding more is blocked.
9. **Super Admins:** invite a second Super Admin; try to deactivate the last active one and
   confirm it is rejected.
10. **Automated tests:** `pnpm --filter @wizer/api test` covers Super-Admin-only
    access, suspend/reactivate, last-Super-Admin protection, plan-limit checks, grace-period
    logic, subscription/invoice status changes, and audit logging.

## Related docs

- [admin-guide.md](./admin-guide.md) · [security.md](./security.md) ·
  [multi-tenancy.md](./multi-tenancy.md) · [database-schema.md](./database-schema.md) ·
  [roadmap.md](./roadmap.md) · [api-future.md](./api-future.md)
