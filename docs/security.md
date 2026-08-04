# Security Model

> **Phase 0 — Plan.** This document specifies the authentication, authorization, and
> account-security model. Each control is tagged with the phase in which it is implemented
> (see [roadmap.md](./roadmap.md)); the rules are binding as designed.

## 1. Roles & capability matrix

Wizer Signage defines five roles. **Super Admin** is a platform-level role (cross-tenant,
see [multi-tenancy.md](./multi-tenancy.md)); the other four are scoped to a single company
and, where relevant, to specific locations.

| Role                 | Scope                   | Summary                                                                                                                        |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Super Admin**      | Platform (all tenants)  | Operates the platform: provisioning, support, billing oversight, ApkVersion management, cross-tenant access. **2FA required.** |
| **Company Admin**    | One company             | Full control of their company: users, locations, screens, content, schedules, billing.                                         |
| **Location Manager** | Assigned location(s)    | Manages screens, content scheduling, and commands for their location(s) only.                                                  |
| **Content Manager**  | One company (content)   | Uploads/organizes content, builds playlists/schedules; no user or billing administration.                                      |
| **Viewer**           | One company (read-only) | Read-only dashboards, reports, and status; cannot make changes.                                                                |

### Capability matrix

Legend: ✅ allowed · 🔸 limited / own-scope only · ❌ denied.

| Capability                        | Super Admin | Company Admin | Location Manager | Content Manager | Viewer |
| --------------------------------- | :---------: | :-----------: | :--------------: | :-------------: | :----: |
| Manage platform / other tenants   |     ✅      |      ❌       |        ❌        |       ❌        |   ❌   |
| Manage company settings & billing |     ✅      |      ✅       |        ❌        |       ❌        |   ❌   |
| Manage users & roles (in company) |     ✅      |      ✅       |        ❌        |       ❌        |   ❌   |
| Manage locations                  |     ✅      |      ✅       |  🔸 (assigned)   |       ❌        |   ❌   |
| Pair / manage screens             |     ✅      |      ✅       |  🔸 (assigned)   |       ❌        |   ❌   |
| Upload / manage content           |     ✅      |      ✅       |  🔸 (assigned)   |       ✅        |   ❌   |
| Build playlists & schedules       |     ✅      |      ✅       |  🔸 (assigned)   |       ✅        |   ❌   |
| Send remote commands              |     ✅      |      ✅       |  🔸 (assigned)   |       ❌        |   ❌   |
| Trigger emergency broadcast       |     ✅      |      ✅       |  🔸 (assigned)   |       ❌        |   ❌   |
| View reports / proof-of-play      |     ✅      |      ✅       |  🔸 (assigned)   |       ✅        |   ✅   |
| View audit / login logs           |     ✅      |      ✅       |        ❌        |       ❌        |   ❌   |

Permissions are enforced server-side by role/permission guards in the API; the dashboard
hides unavailable actions but the API is the source of truth. Roles always combine with
the tenant scope — a Company Admin can only ever act within their own `companyId`.

## 2. Authentication

- **Email + password** primary login. _(Phase: Auth)_
- **Invitations** — admins invite users by email; invitation links **expire after 3 days**.
  Accepting an invite sets the user's password (and 2FA, if required by role). _(Phase: Auth)_
- **Password reset** — self-service via emailed, time-limited single-use token. _(Phase: Auth)_
- **Two-Factor Authentication (2FA)** — TOTP **authenticator app** plus one-time
  **backup codes** issued at enrollment. **2FA is REQUIRED for every Super Admin** and
  optional (admin-enforceable) for other roles. _(Phase: Auth/2FA)_
- Email delivery uses the `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
  `SMTP_FROM` environment variables (see [environment-variables.md](./environment-variables.md)).

### Tokens

- Access/refresh tokens are JWTs signed with `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
  and expire per `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL`. Access tokens carry the principal
  and `companyId`; tenant context is derived from the token, never the client.
- Devices authenticate with a separate **device token** bound to the paired screen (see
  [pairing-guide.md](./pairing-guide.md)).

## 3. Password policy

_(Phase: Auth)_

- Minimum **10 characters**.
- Must include **upper-case, lower-case, a number, and a symbol**.
- **Block weak/common passwords** (dictionary / breached-password list).
- **Prevent immediate reuse** — a new password cannot equal the current/most-recent
  password(s).
- Passwords are stored only as strong one-way hashes (e.g. Argon2/bcrypt); plaintext is
  never logged or persisted.

## 4. Account lockout

_(Phase: Auth)_

- **7 failed login attempts** lock the account for **15 minutes** (automatic unlock after
  the window).
- A locked-out **Super Admin** can additionally require **manual unlock** by another Super
  Admin, rather than relying solely on the timed window.
- Lockouts and failed attempts are recorded for audit and alerting.

## 5. Sessions

_(Phase: Auth/Sessions)_

- **30-minute inactivity auto-logout** — sessions expire after 30 minutes of inactivity
  (`SESSION_INACTIVITY_TIMEOUT_MINUTES`, default `30`).
- **Active sessions view** — users (and admins) can see their active sessions with device,
  IP, and last-activity metadata.
- **Remote session termination** — a user can revoke a session, and admins can terminate a
  user's sessions (forced sign-out), e.g. on suspected compromise.

## 6. Login & audit logging, suspicious-login alerts

_(Phase: Auth + Audit)_

- **Login logs** capture successes and failures (timestamp, IP, user agent, outcome).
- **Audit logs** (`ActivityLog`) record security-relevant and tenant-significant actions
  (user/role changes, content/schedule changes, command dispatch, billing changes,
  cross-tenant Super Admin actions).
- **Suspicious-login alerts** notify the user/admins of anomalous sign-ins (new
  device/location, impossible travel, repeated failures).
- Logs are tenant-scoped (except platform-level Super Admin actions) and retained per the
  retention defaults in [database-schema.md](./database-schema.md) (90 days for logs).

## 7. Last-Super-Admin protection

- The platform **prevents deleting or disabling the last active Super Admin**. Any
  operation (delete, deactivate, role change, lockout-induced disable) that would leave
  **zero active Super Admins** is rejected. This guarantees the platform can always be
  administered.

## 8. Transport, SSL & secrets

- **All traffic is HTTPS.** Nginx terminates TLS using **Let's Encrypt** certificates
  and proxies to the dashboard and the API (see
  [production-deployment.md](./production-deployment.md)). Players are HTTPS clients
  too — they poll the same API; there is no separate socket transport.
- **HSTS** and secure cookie attributes are set.
- **Secrets** (`JWT_*`, `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_PASSWORD`, `MAP_API_KEY`,
  database URLs) are supplied via environment variables / a secrets manager — **never**
  committed to the repository. `.env.example` documents names only, not values.
- `SUPABASE_SERVICE_ROLE_KEY` is used **only** server-side (API); it is never exposed to
  the dashboard or the player. Only `NEXT_PUBLIC_*` values may reach the browser.
- `CORS_ORIGINS` restricts which origins may call the API.

## 9. Dependency advisories

CI runs `pnpm audit --prod --audit-level=high`, so **high and critical findings fail the
build** while moderate and low ones are reported by a separate non-blocking step. That
threshold keeps the gate actionable, but it means moderates need a deliberate pass —
they will not stop a merge on their own.

Transitive advisories are pinned through `pnpm.overrides` in the root `package.json`
rather than by waiting for the intermediate package to re-release. Each entry is
range-scoped (`"pkg@<fixed": "^fixed"`) so it applies only to the vulnerable range and
lapses naturally once the dependency catches up.

| Advisory                        | Override  | Why this version                                                                         |
| ------------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `file-type` ASF loop + ZIP bomb | `^21.3.4` | `@nestjs/common` loads it via a dynamic `import()`, so an ESM-only v21 is fine           |
| `uuid` v3/v5/v6 bounds check    | `^11.1.1` | Last line still shipping a CJS build — `exceljs` does `require('uuid')`; v14 is ESM-only |
| `qs` `stringify` DoS            | `^6.15.3` | Stays within the 6.x that express 4 expects                                              |
| `body-parser` limit bypass      | `^1.20.6` | 1.x patch; 2.x is for express 5                                                          |

### Known exception: `@nestjs/core` (GHSA-36xv-jgw5-4q75)

`SseStream._transform()` writes `message.type` and `message.id` into the Server-Sent
Events protocol without escaping newlines, allowing SSE frame injection. **There is no
10.x fix** — the patch is `@nestjs/core@11.1.18`, and `10.4.22` is the final 10.x
release. This API runs Nest 10, so `pnpm audit` reports it and will keep doing so.

It is **not exposed**: Nest constructs an `SseStream` only for a route carrying
`SSE_METADATA`, which only the `@Sse()` decorator sets, and this API declares no SSE
route. The vulnerable code is never entered.

That is a fact about today's code, not a guarantee, so it is pinned by a test —
`apps/api/src/common/security/no-sse-on-nest10.spec.ts` fails if an `@Sse()` handler is
added while `@nestjs/core` is still on 10.x, and names the upgrade in the failure. The
test disables itself once Nest reaches 11 and should be deleted with that upgrade.

Clearing the advisory properly means the Nest 10 → 11 major upgrade, which is tracked
separately rather than bundled into a dependency sweep.

## 10. Implementation phasing

| Control                                                     | Implemented in      |
| ----------------------------------------------------------- | ------------------- |
| Roles & guards, tenant scoping                              | Auth / Tenant phase |
| Email+password, invitations, password reset                 | Auth phase          |
| Password policy, lockout                                    | Auth phase          |
| 2FA (authenticator + backup codes), Super Admin enforcement | Auth/2FA phase      |
| Sessions (inactivity, active-sessions, remote termination)  | Sessions phase      |
| Login/audit logs, suspicious-login alerts                   | Audit phase         |
| Last-Super-Admin protection                                 | Auth phase          |
| SSL/HSTS, secrets handling                                  | Deployment phase    |

See [roadmap.md](./roadmap.md) for exact phase numbers.

## Related docs

- [multi-tenancy.md](./multi-tenancy.md) · [architecture.md](./architecture.md) ·
  [database-schema.md](./database-schema.md) · [environment-variables.md](./environment-variables.md)
