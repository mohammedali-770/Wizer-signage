# Playlists (Phase 5)

A **playlist** is an ordered sequence of existing **Content Library** items that a
screen plays one after another. Playlists never hold their own media — they
reference content by id, so a single uploaded file is reused across any number of
playlists (no duplication). Playlists are company-scoped and never cross tenants.

## Data model

`Playlist`
| field | notes |
| --- | --- |
| `id`, `companyId` | tenant-scoped |
| `title`, `description` | |
| `status` | `DRAFT` \| `ACTIVE` \| `ARCHIVED` |
| `createdById`, `updatedById` | audit |
| `archivedAt`, `deletedAt` | archive marker / soft delete |

`PlaylistItem`
| field | notes |
| --- | --- |
| `position` | 0-based playback order, kept contiguous |
| `contentId` | references `Content` (same company) |
| `durationSeconds` | per-item dwell time; `null` → content default |
| `playFullVideo` | video plays its full length (ignores `durationSeconds`) |
| `pdfPageDurationSeconds` | per-page dwell for multi-page PDFs |
| `transitionType` | future-ready (`"none"`, `"fade"`, …) |
| `settings` | JSON for per-item extras |

## Rules

- A playlist may only contain content from **the same company**.
- Only **ACTIVE, non-expired** content can be **added**. Archived, trashed, or
  expired content is blocked at add time.
- If content later becomes archived/trashed/expired/deleted, the playlist keeps
  the item but flags it as **invalid** (with a reason) in the detail/validation
  views, and the **playback manifest skips it safely**.
- A playlist is **schedulable** only when it has **at least one valid item** and is
  not archived.
- Editing items requires the playlist to be `ACTIVE` or `DRAFT` (unarchive first).

### Duration rules

- Image / Text / URL / PDF: `durationSeconds ≥ 1` (or the content default).
- Video: either `playFullVideo = true` **or** `durationSeconds ≥ 1`.
- Total estimate: full videos contribute their known/declared length; a PDF with
  `pdfPageDurationSeconds` contributes `pages × per-page`.

## API

All routes are under `/api/playlists` and require `playlist:read` (reads) or
`playlist:manage` (writes). `companyId` is always taken from the token.

| method   | path                                    | purpose                                                    |
| -------- | --------------------------------------- | ---------------------------------------------------------- |
| `GET`    | `/playlists`                            | list (filter `status`, `search`, `createdFrom/To`, `sort`) |
| `POST`   | `/playlists`                            | create (optionally with initial `items[]`)                 |
| `GET`    | `/playlists/:id`                        | detail with items + per-item validity                      |
| `GET`    | `/playlists/:id/validate`               | schedulable? invalid items, orientation, total duration    |
| `PATCH`  | `/playlists/:id`                        | update title / description / status                        |
| `POST`   | `/playlists/:id/archive` · `/unarchive` | lifecycle                                                  |
| `POST`   | `/playlists/:id/duplicate`              | copy (all items)                                           |
| `DELETE` | `/playlists/:id`                        | soft delete                                                |
| `POST`   | `/playlists/:id/items`                  | add an item (append, or `position` to insert)              |
| `PATCH`  | `/playlists/:id/items/reorder`          | reorder (full ordered `itemIds[]`)                         |
| `PATCH`  | `/playlists/:id/items/:itemId`          | edit duration / full-play / PDF page duration              |
| `DELETE` | `/playlists/:id/items/:itemId`          | remove (positions re-compact)                              |

## Dashboard

`/{locale}/company/playlists` — list with status tabs and search.
`/{locale}/company/playlists/new` — create.
`/{locale}/company/playlists/[id]` — the **builder**: add content from the library
(filtered picker), reorder, set per-item duration / full-video / PDF page duration,
preview an item, see total duration, orientation profile, and invalid-item
warnings. Content upload stays in the Content Library — the builder only
references existing content.

## Orientation profile

A playlist is `LANDSCAPE`, `PORTRAIT`, `MIXED`, or `UNKNOWN` based on its valid
items' orientations. This profile drives the orientation **warnings** shown when a
schedule targets screens of a different orientation (warning only — never blocks).

## Activity log

`playlist.created/updated/archived/unarchived/deleted/duplicated`,
`playlist.item_added/updated/removed`, `playlist.items_reordered` — all
company-scoped.
