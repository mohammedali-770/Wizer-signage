# Notifications & Alerts (Phase 10)

MasterSignage surfaces operational events two ways: **dashboard notifications**
(a per-user bell + center) and **alerts** (deduplicated, acknowledgeable
records). Email delivery is layered on top, governed by per-user preferences.

## Alerts vs. notifications

- **Alert** — a deduplicated record of an operational condition (screen offline,
  sync failed, storage near limit, subscription expiring, backup failed, …). It
  has a lifecycle: `OPEN → ACKNOWLEDGED → RESOLVED | DISMISSED`. Company-scoped;
  `companyId` is null for platform/system alerts (Super Admin).
- **Notification** — a per-user, read/unread message. When a NEW alert is raised
  it fans out a notification to the relevant users (company admins / location
  managers for company alerts; super admins for system alerts).

## Deduplication & auto-resolution (anti-spam)

Alerts are **deduplicated** while unresolved via a `dedupeKey` (default
`companyId:screenId:type`). Raising the same condition again **updates** the
existing OPEN/ACKNOWLEDGED alert instead of creating a new row or re-notifying —
so a screen that is offline across many maintenance sweeps produces **one** alert,
not one per sweep.

Conditions **auto-resolve** when they clear:

- a clean **heartbeat** resolves the screen's offline/warning alerts (and emits a
  one-time "back online" notification on genuine recovery);
- the **maintenance sweep** resolves storage/subscription/grace/content alerts
  once the underlying value returns to normal;
- ending an emergency resolves its "activated" alert.

## Where alerts come from

| Source                       | Events                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Heartbeat (event-driven)     | screen warning (raise) / screen online (resolve)                                                                                         |
| Emergency service            | emergency activated / ended                                                                                                              |
| Scheduled-report runner      | report failed                                                                                                                            |
| Backup service               | backup failed / database backup overdue                                                                                                  |
| **Maintenance sweep** (cron) | screen offline (no heartbeat), subscription expiring/expired, grace ending, storage near/exceeded, plan limit exceeded, content expiring |

The sweep is how time/threshold conditions (which have no event hook) become
alerts — see [data-retention.md](./data-retention.md) for how it is scheduled.

## Email (SMTP)

Emails are sent through the existing `MailService` (nodemailer). **When SMTP is
not configured, emails are logged, not sent** (dev mode) — flows still work.

Environment (`SMTP_PASS` is an accepted alias for `SMTP_PASSWORD`):

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=…          # or SMTP_PASS
SMTP_FROM="MasterSignage <no-reply@example.com>"
SMTP_SECURE=false        # force TLS; otherwise derived from port 465
```

Every send is recorded in **`EmailDeliveryLog`** (`PENDING → SENT | FAILED` with
the provider message id or error). **A send failure is logged, never thrown** —
it can never break the originating action.

### What emails by default

Every event raises a **dashboard** notification. Only a curated set also **emails**
by default (the rest are dashboard-only to avoid noise): screen offline / back
online, emergency activated / ended, subscription expiring, grace ending, backup
failed, scheduled report failed. Users override per event under
**Notifications → Email notifications** (stored in `NotificationPreference`; an
absent row means "use the default").

## Dashboard

- **Bell** (header, both consoles) — unread count (polled every 30s) + a dropdown
  of recent notifications with mark-read / mark-all.
- **`/company/notifications`** (+ `/admin/notifications`) — the notification
  center + email preferences.
- **`/company/alerts`** — filter by status/severity, acknowledge / resolve /
  dismiss, and export.

## Permissions

- `alert:read` — view alerts (Viewer+).
- `alert:manage` — acknowledge / resolve / dismiss (Company Admin + Location
  Manager).
- Notifications are user-scoped — no special permission beyond authentication.

## API

| Method & path                                    | Purpose                                 | Auth           |
| ------------------------------------------------ | --------------------------------------- | -------------- |
| `GET /notifications` · `/unread-count`           | List + badge count                      | self           |
| `POST /notifications/:id/read` · `/read-all`     | Mark read                               | self           |
| `GET/PUT /notifications/preferences`             | Channel/event opt in/out                | self           |
| `GET /alerts`                                    | List (status/severity/type/screen/date) | `alert:read`   |
| `POST /alerts/:id/{acknowledge,resolve,dismiss}` | Manage                                  | `alert:manage` |

## Not in scope (per spec)

No WhatsApp; no full webhook delivery system; email + dashboard only.
