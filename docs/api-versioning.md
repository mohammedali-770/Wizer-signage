# API Versioning and Breaking Changes

## Where things actually stand

**There is no API version _in the routes_.** They are served under a bare `/api`
prefix with no version segment — `/api/auth/login`, not `/api/v1/auth/login`.
`servers` in the contract is still empty.

The contract does now carry a release number: `info.version` is **`1.0.0`**,
pinned from `apps/api/package.json`. That is a release marker, not a negotiable
API version — a client cannot ask for `1.0.0` and keep getting it.

The practical consequence: **a breaking change reaches every caller the moment
it deploys.** There is no older version still being served, no deprecation
window, and no way for a client to pin the shape it was written against.

That is a reasonable position for a product whose only clients ship with it. It
stops being reasonable the day someone else integrates, and this document exists
so that day does not arrive unnoticed.

## Who the clients are

| Client              | Talks to         | In this repo                   |
| ------------------- | ---------------- | ------------------------------ |
| Dashboard (Next.js) | most of the API  | yes — `apps/dashboard`         |
| Android TV player   | `/device/*` only | yes — `apps/android-tv-player` |

Both ship from this repository, so a breaking change and its client fix land in
the same commit and deploy together. **That is the only reason the changes below
were safe to make without a version.**

The player's surface is worth stating precisely, because it is the one that
strands hardware if it breaks: `/device/commands`, `/device/config`,
`/device/content`, `/device/heartbeat`, `/device/manifest`, `/device/pairing`,
`/device/proof-of-play`, `/device/screenshots`, `/device/sync-plan`,
`/device/sync-status`. Nothing else.

`/device/manifest` has a second guard: `contracts/device-manifest.*.golden.json`
are parsed by both the API's `device-manifest.contract.spec.ts` and the player's
`ManifestContractTest`, so renaming a field there fails the Kotlin build rather
than blanking a fleet quietly. See `contracts/README.md`.

## Breaking changes shipped on 2026-08-07

All in one day, all in the production-readiness review. None touched `/device/*`,
so **the Android player was unaffected** by every one of them.

### Requests — a previously-valid body is now rejected

| Route                               | Change                                                             | PR  |
| ----------------------------------- | ------------------------------------------------------------------ | --- |
| `POST /auth/2fa/setup`              | now requires `password`; also `currentCode` when 2FA is already on | #61 |
| `POST /auth/2fa/enable`             | as above                                                           | #61 |
| `POST /auth/2fa/disable`            | now requires `password` in addition to `code`                      | #61 |
| `POST /plans`, `PATCH /plans/{id}`  | `price` renamed to `priceMonthly`                                  | #65 |
| `PATCH /scheduled-reports/{id}`     | `recipients` may no longer be `[]`                                 | #64 |
| `POST`/`PATCH` emergency broadcasts | `url` must now be an absolute `http(s)` URL                        | #64 |
| Anything sending `workingHours`     | `outsideHoursBehavior: "SLEEP"` renamed to `"BLANK_SCREEN"`        | #66 |

`SLEEP` is the one rename on this page that did **not** break callers, and it is
worth saying why rather than leaving it looking inconsistent. Working hours are
stored as JSON, not in an enum column, so no migration rewrote existing rows and
every screen configured before the rename still has the old string on disk.
`normalizeBehavior` therefore still accepts `"SLEEP"` and maps it to
`BLANK_SCREEN`. Dropping it instead would have sent those rows through the
`FALLBACK` default, and screens that went dark outside opening hours would have
started showing fallback content with nothing logged to explain it.

The name was wrong: it never slept the display and could not. Renaming rather
than deleting means the operator-facing choice tells the truth while the stored
data keeps working — the deprecation window this page argues for, applied once.

The 2FA routes are a security fix: a bearer token alone could previously enrol an
authenticator, which turns a stolen session into access that outlives a password
reset. See `docs/security.md`.

Note the global `ValidationPipe` sets `forbidNonWhitelisted: true`, so an unknown
property is a **400**, not silently ignored. That is why `captchaToken` and
`recurrence` were marked deprecated rather than deleted — removing a field that
callers may still send would break them for sending something harmless.

### Responses — a field changed type or disappeared

| Shape                                                            | Change                                            | PR  |
| ---------------------------------------------------------------- | ------------------------------------------------- | --- |
| `DELETE /sessions/others`, `POST /sessions/users/{id}/terminate` | `revoked` (number) → `revokedCount`               | #64 |
| Scheduled-report delivery                                        | `fileStorageKey` removed                          | #64 |
| `GET /public/plans`                                              | `priceMonthly`, `priceYearly` number → **string** | #65 |
| Platform overview                                                | `invoices.unpaidTotal` number → **string**        | #65 |
| Usage                                                            | `storageBytes` number → **string**                | #65 |

The money changes make one column one type everywhere. `priceMonthly` was a JSON
number publicly and a string for Super Admins, because exactly one code path
passed the Prisma `Decimal` through `Number()`; a `Decimal` cannot round-trip
through a JS float exactly, and this is billing data. A test now walks the whole
contract and fails on any money field typed as a number, so a fourth encoding
cannot reappear.

`revoked` → `revokedCount` was chosen over making both routes return a number
**because it breaks loudly**: a client still reading `revoked` gets `undefined`
immediately, rather than truthy-testing a count and appearing to work.

### Contract schema renames — documentation only

Three response models were renamed in `contracts/openapi.json` (#63) because
they collided with request DTOs of the same name, and OpenAPI schema names are
global — one silently overwrote the other:

- `DemoRequestDto` → `AdminDemoRequestDto`
- `PlanLimitsDto` → `PlanLimitsViewDto`
- `ProofOfPlayEventDto` → `ProofOfPlayRecordDto`

**No wire format changed.** Only generated clients that key off schema names are
affected. The collision meant `POST /public/demo-request` was publishing an admin
record — `id`, `status`, `ip`, `userAgent` — as the body a caller should _send_,
so the rename fixed a contract that was actively wrong.

## Proposed policy

> **Not yet adopted.** This section is a proposal, recorded so the decision is
> made deliberately rather than by the first external integration.

### While the only clients live in this repository

Keep the unversioned `/api` prefix. Versioning has a real cost — two shapes to
maintain, two sets of tests — and buys nothing when the client and server deploy
together. Instead:

1. **Every breaking change is recorded here**, in the table above, with its PR.
2. **The client fix ships in the same commit** as the API change, never after.
3. **`pnpm -w typecheck` plus the dashboard production build** must pass, since
   those are what actually catch a client left behind. The dashboard build is the
   check that would have caught the money change if a call site had been missed.
4. **Prefer a rename over a type change** where both are available. A renamed
   field fails immediately; a retyped one can limp along under JS coercion and
   fail later on a value that happens to be different.

### The day a third-party client exists

Adopt one of these before granting the first API key, not after:

- **URL versioning** (`/api/v1/...`) — simplest to reason about, and Nest
  supports it directly via `app.enableVersioning({ type: VersioningType.URI })`.
  Costs a path change for every existing caller once.
- **Header versioning** (`Accept-Version`) — no path churn, but harder to test
  by hand and easy for a client to omit.

Whichever is chosen, a deprecation window must be written down alongside it — a
field cannot be removed in the same release it is marked deprecated.

### `info.version` — done

It used to advertise `0.0.0`, which told a reader nothing and would have been
actively misleading once versioning existed. Every workspace manifest is now
`1.0.0`, and `apps/api/package.json` is the single source: it feeds
`info.version` through `apps/api/scripts/emit-openapi.ts`, the Swagger docs, and
`GET /api/health`.

That last one was quietly broken. `HealthService` read `npm_package_version`,
which is set only when npm or pnpm starts the process — and the production image
runs `CMD ["node", "dist/main.js"]`, so the endpoint an operator checks after a
deploy answered `0.0.0` for every release ever cut, while the contract carried
the real number. Both now read the same manifest via `apps/api/src/common/version.ts`,
and `version.spec.ts` pins the wiring, including the Dockerfile `COPY` the path
depends on.

Bumping the number is not on its own a promise of stability; the policy below is
what would be.

## Related

- `contracts/README.md` — how `openapi.json` and the device-manifest golden
  fixtures are generated and checked
- `docs/security.md` — the 2FA re-authentication rule and why it was added
- `apps/api/src/common/openapi-responses.spec.ts` and `openapi-requests.spec.ts`
  — the guards that pin response and request shapes, including the money
  invariant and the duplicate-schema-name check
