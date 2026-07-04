# Content Library Guide (Phase 4)

> **Implemented in Phase 4.** Company users upload and manage ready-made signage content —
> images, videos, PDFs, URL content, and text announcements — with preview, tags, expiry,
> archive/trash/restore, bulk actions, storage tracking, and fallback-content selection.
> Builds on Phase 1–3 (auth/tenancy/RBAC, usage-limits/grace, the Tag system, the Company
> console). **Content is ready-made only** — no design editor, templates, or dynamic menus.
> Playlists, schedules, and the Android player come in later phases.

## 1. The Content Library

Company console → **Content Library** (`/{locale}/company/content`). Everything is
company-scoped (the `companyId` comes from the token, never the client). RBAC: **Company
Admin / Content Manager** manage content; **Viewer** is read-only;
`GET /api/content/...` requires `content:read`, mutations require `content:manage`.

## 2. Supported content & upload rules

| Type      | How                                          | Validation                                          |
| --------- | -------------------------------------------- | --------------------------------------------------- |
| **Image** | File upload                                  | `image/jpeg, png, gif, webp` (+ matching extension) |
| **Video** | File upload                                  | `video/mp4, webm, ogg, quicktime`                   |
| **PDF**   | File upload                                  | `application/pdf`                                   |
| **URL**   | No file — store a URL                        | must be `http(s)`                                   |
| **Text**  | No file — store a text body + optional style | —                                                   |

The content **type is inferred from the file's MIME type**; both MIME and extension are
validated. Per-file size and total storage are enforced against the plan (see §6).
`durationSeconds` and PDF `pageCount` are nullable placeholders (no media probing in v1).

## 3. Storage setup (Supabase Storage)

Files are stored under **company-scoped keys**:
`companies/{companyId}/content/{contentId}/{filename}`, in a **private** bucket. Previews and
downloads use **short-lived signed URLs** (`GET /api/content/:id/preview`) — no public,
unrestricted URLs.

- Production env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`
  (the service-role key is server-only; create the bucket in Supabase Storage, private).
- **Local dev fallback:** when Supabase isn't configured, a local disk adapter is used
  (`STORAGE_LOCAL_DIR`, default `<api>/.storage`). It serves files via an encrypted,
  time-limited token URL (`/api/content-files/:token`) so previews work without Supabase.
  The interface (`StorageService.upload/getSignedUrl/remove`) is identical, so no app code
  changes between adapters.

## 4. URL content limitations

URL content is previewed in a sandboxed `<iframe>`. Many external sites block embedding
(`X-Frame-Options` / CSP) — the dashboard always offers an **"Open in a new tab"** fallback
and warns that external pages may be unreliable or change without notice. Only `http(s)`
URLs are accepted.

## 5. Text announcements

Text content stores a `textBody` (and optional `textStyle` JSON for future styling). It is
previewed as centered text. Useful for quick notices without designing an image.

## 6. Storage limits & plan enforcement

Reuses the Phase 2 usage-limits / grace-period service:

- **Per-file max size** (`maxFileSizeMb`) is enforced on every upload/replace.
- **Total storage** (`storageGb`) is enforced via the grace-aware `assertCanAdd('storageGb',
fileGb)`: within limit → allowed; first overage → **7-day grace** (still allowed); after
  grace → **blocked**. Existing files are never removed by enforcement.
- The library shows a **storage usage card** (used vs limit, percent, grace/blocked banner).
- Storage usage counts files still present (not yet cleaned up). Archived/trashed content
  still occupies storage until the trash cleanup permanently removes it.

## 7. Archive, trash, restore, soft delete

Statuses: **ACTIVE** (in the library; selectable as fallback) · **ARCHIVED** (hidden by
default; viewable via the Archived tab; not selectable as fallback until unarchived) ·
**TRASH** (hidden; restorable for **14 days**) · **DELETED** (internal tombstone after
cleanup).

- Trashing/archiving **never deletes the storage file immediately** — only metadata changes.
- **Trash retention is 14 days.** The cleanup foundation
  (`ContentCleanupService.purgeExpiredTrash`) finds TRASH items older than 14 days, removes
  the storage file, marks the row `DELETED` + `deletedAt` (kept as an audited tombstone). A
  scheduled job runs it platform-wide; the console can purge its **own** eligible trash on
  demand (`POST /api/content/trash/purge`).

## 8. Expiry

Content can carry a nullable `expiresAt`. Expired content is clearly marked and is **not
valid** for future playlist/schedule phases (a validity helper is provided now). Filter by
**active / expiring (≤ 7 days) / expired / no-expiry**. Expiry changes are audited
(`content.expiry_changed`).

## 9. Tags / categories

Reuses the existing **Tag** system (Phase 3). Content may use tags whose **type is CONTENT or
BOTH** — SCREEN-only tags are rejected. Create tags on the Tags page; select existing tags
on content. Filter the library by tag; bulk add/remove tags across selected content.

## 10. Bulk actions

Select multiple items → **bulk archive / unarchive / trash / restore** and **bulk add/remove
tag** (`POST /api/content/bulk/...`). Destructive actions confirm via dialog and are audited.

## 11. Fallback content selection

The Phase 3 fallback placeholders are now wired to **real Content**:

- **Company** (Settings), **Location** (location detail), and **Screen** (screen detail) each
  have a fallback-content picker. Only **ACTIVE, same-company** content can be selected
  (server-validated; 400 otherwise).
- The picker **warns** (does not block) when the chosen content is expired, or — for a screen
  — when its orientation conflicts with the screen's orientation. If content is later
  archived/trashed/expired, the dashboard flags it and future player phases ignore it.

## 12. API endpoints (Phase 4, company-scoped)

```
GET  /api/content            GET /api/content/usage
POST /api/content/upload (multipart)   POST /api/content/url   POST /api/content/text
GET  /api/content/:id        GET /api/content/:id/preview
PATCH /api/content/:id       POST /api/content/:id/replace (multipart)
POST /api/content/:id/archive|unarchive|trash|restore
POST /api/content/bulk/archive|unarchive|trash|restore   POST /api/content/bulk/tags
POST /api/content/trash/purge
```

## 13. How to test Phase 4

1. Run the stack (see [local-development.md](./local-development.md)); migrate + seed; sign
   in as the **Company Admin**; open **Content Library**. (No Supabase needed locally — the
   local storage adapter handles previews.)
2. **Upload** an image/video/PDF; create a **URL** item and a **Text** announcement. Confirm
   previews render (and the open-link fallback for blocked URLs).
3. Add **content tags** (type CONTENT/BOTH) and filter by them; confirm a SCREEN-only tag
   cannot be attached.
4. Set an **expiry**; filter by expiring/expired; confirm the "Expired" badge.
5. **Archive → Unarchive**, **Trash → Restore**; use **bulk** archive/trash/restore/tag.
6. **Fallback:** in Settings / a location / a screen, pick a fallback content item; confirm
   only ACTIVE content is selectable and the orientation/expiry warnings appear.
7. **Limits:** with a small plan `storageGb`/`maxFileSizeMb` (set via the Super Admin
   console), upload past the limits — oversize files are blocked; storage overage opens a
   7-day grace then blocks.
8. **Trash cleanup:** trash an item; `POST /api/content/trash/purge` removes items past 14
   days (older trash only). **Tenant isolation:** another company can't see or fetch your
   content (every `:id` is company-scoped → 404).
9. **Automated tests:** `pnpm --filter @wizer/api test` covers file-type/size
   validation, storage-grace, URL/text creation, archive/trash/restore, cleanup eligibility,
   CONTENT/BOTH-only tagging, fallback selectability, and audit logging.

## Related docs

- [company-management.md](./company-management.md) · [super-admin-guide.md](./super-admin-guide.md) ·
  [environment-variables.md](./environment-variables.md) · [database-schema.md](./database-schema.md) ·
  [roadmap.md](./roadmap.md)
