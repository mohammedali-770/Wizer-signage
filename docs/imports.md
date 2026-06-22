# Bulk Imports (Phase 10)

Bulk-create administrative data from CSV or XLSX, reusing the **same** create
services as the dashboard forms — so the same uniqueness, reference, and
**plan-limit** rules apply.

## Supported imports

| Type           | Scope                | Reuses                                                       |
| -------------- | -------------------- | ------------------------------------------------------------ |
| `LOCATION`     | Company (tenant)     | LocationsService.create (plan limit)                         |
| `SCREEN`       | Company              | ScreensService.create (plan limit, location/tag/group refs)  |
| `SCREEN_GROUP` | Company              | ScreenGroupsService.create                                   |
| `TAG`          | Company              | TagsService.create                                           |
| `USER`         | Company              | InvitationsService.create (user-seat limit; sends an invite) |
| `COMPANY`      | **Super Admin only** | CompaniesService.create (mints a new company)                |

## Flow: upload → validate → preview → commit

1. **Download a template** — `GET /imports/templates/:type` returns a CSV with the
   header row + a sample.
2. **Upload** — `POST /imports?type=:type` (multipart `file`, CSV or XLSX, ≤15 MB).
   The file is parsed and each row is validated (required fields, email format,
   enum values). An `ImportJob` is created with status `VALIDATED`, per-row errors,
   and counts. **Nothing is created yet.**
3. **Review** the preview (valid / invalid counts + row errors).
4. **Commit** — `POST /imports/:id/commit` runs the entity create service for each
   valid row. Uniqueness / reference / plan-limit failures surface as **per-row
   errors** without aborting the batch. Status becomes `COMMITTED` (or `FAILED` if
   nothing committed).

History: `GET /imports` · detail `GET /imports/:id` · `POST /imports/:id/cancel`.

## Column templates

| Type         | Columns (required **bold**)                                 |
| ------------ | ----------------------------------------------------------- |
| LOCATION     | **name**, code, city, region, country, timezone             |
| SCREEN       | **name**, code, location _(code or name)_, orientation, use |
| SCREEN_GROUP | **name**, description, category                             |
| TAG          | **name**, type _(SCREEN/CONTENT/BOTH)_, color, description  |
| USER         | **email**, name, **role** _(not SUPER_ADMIN)_               |
| COMPANY      | **name**, slug, timezone                                    |

Validation examples: required columns present; `email` is a valid address; `role`
is a non-`SUPER_ADMIN` `UserRole`; `orientation`/`use`/`type` are valid enum
values; a SCREEN's `location` resolves to an existing location in the company
(checked at commit). Deep checks (uniqueness, plan limits) run in the create
service at commit and are reported per row.

## Tenant safety

- **`companyId` always comes from the authenticated tenant — never from the
  file.** A company admin importing locations/screens/users can only ever create
  them in their own company.
- The **COMPANY** import is the only one that creates new companies, and it is
  **Super Admin only** (enforced in the service, not just the route).
- A USER import can never invite a `SUPER_ADMIN` (rejected at validation).

## Plan limits

Because imports call the real create services, `usageLimits.assertCanAdd(...)` is
enforced per created row. Exceeding the plan limit starts/continues the grace
period exactly as a single create would, and over-limit rows fail with a clear
per-row error.

## Permissions & audit

`import:run` (Company Admin; Super Admin implicitly). Every step is audit-logged:
`import.uploaded`, `import.committed` / `import.failed`, `import.cancelled`
(category `IMPORT`). Individual created rows are logged by their own create
services.

## Limitations

- Screen imports set name/code/location/orientation/use; tag/group assignment is
  done afterward in the UI (kept out of the v1 importer for clarity).
- XLSX reads the first worksheet. Max 5,000 rows per file.
