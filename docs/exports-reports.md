# Exports & Scheduled Reports (Phase 10)

## Exports

`GET /exports/:dataset?format=CSV|XLSX|PDF` streams a tenant-scoped file.

| Dataset         | Scope                            | Notes                                   |
| --------------- | -------------------------------- | --------------------------------------- |
| `proof-of-play` | Company                          | filters: from, to, screenId, status     |
| `screen-health` | Company                          | live status + last telemetry per screen |
| `alerts`        | Company (system for Super Admin) | filters: from, to, status               |
| `activity-logs` | Company (all for Super Admin)    | filters: from, to                       |
| `screens`       | Company                          |                                         |
| `locations`     | Company                          |                                         |
| `invoices`      | Company (all for Super Admin)    | financial — exported, never deleted     |
| `companies`     | **Super Admin only**             |                                         |

**Formats:** `CSV` (RFC-4180, formula-injection-hardened), `XLSX` (real
spreadsheet via exceljs), `PDF` → a **print-optimized HTML** document the operator
prints to PDF (the spec-sanctioned fallback — no native PDF engine is bundled; a
true PDF renderer is a future enhancement). Each export is row-capped (50k) and
audit-logged (`export.generated`, category `EXPORT`).

Requires `report:read` (held by all roles, including Viewer). The service enforces
dataset-level scoping; the `companies` dataset rejects non-Super-Admins. In the
dashboard, an **Export** button (CSV/Excel/PDF) appears on the alerts and
monitoring pages; proof-of-play has its own export.

## Scheduled reports

A `ScheduledReport` recurs (`DAILY` / `WEEKLY` / `MONTHLY`), renders one of the
report datasets in a chosen format, stores the file, and **emails recipients a
signed download link** (valid 7 days). Each run records a `ScheduledReportDelivery`
(`PENDING → SENT | FAILED`).

| Method & path                                  | Purpose                                         |
| ---------------------------------------------- | ----------------------------------------------- |
| `GET/POST /scheduled-reports`                  | List / create                                   |
| `GET /scheduled-reports/:id`                   | Detail + recent deliveries                      |
| `PATCH /scheduled-reports/:id`                 | Edit (recomputes `nextRunAt` on cadence change) |
| `POST /scheduled-reports/:id/{enable,disable}` | Toggle                                          |
| `POST /scheduled-reports/:id/run`              | **Run now** + email                             |
| `DELETE /scheduled-reports/:id`                | Delete                                          |

Reads need `report:read`; create/manage/run need `report:schedule` (Company
Admin). Dashboard: **/company/reports/scheduled**.

### Execution model (no in-process scheduler)

Reports are executed by the **maintenance runner** (`runDue()`), which the CLI/cron
calls — see [data-retention.md](./data-retention.md). `nextRunAt` is advanced
after each run; a permanently-failing report still advances (so it never blocks
the runner) and raises a `report.failed` alert. A delivery failure is recorded and
alerted — it never throws.

### Reliability

- Email send failures are logged in `EmailDeliveryLog` and never crash the run.
- A failed render/store records a `FAILED` delivery + a `report.failed` alert.
- Generated report files are subject to retention cleanup (their storage objects
  are removed with the rows).

## Not in scope

True server-side PDF rendering and per-report attachment emails are future
enhancements; today PDF = print-HTML and reports email a signed link.
