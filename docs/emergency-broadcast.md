# Emergency Broadcast (Phase 9)

An emergency broadcast pre-empts **all** normal playback on its targeted screens —
for incidents (evacuation notices, alerts) where a message must show immediately,
regardless of schedules or working hours.

## Model & lifecycle

`EmergencyBroadcast` belongs to one company and has a `broadcastType`:

- `CONTENT` — a single ACTIVE library content item.
- `PLAYLIST` — an ACTIVE playlist (its valid items loop).
- `TEXT` — a full-screen text message (`message`).
- `URL` — an external URL.

Lifecycle: `DRAFT` → (`ACTIVE` | `SCHEDULED`) → `PAUSED` ⇄ `ACTIVE` → `ENDED` →
`ARCHIVED`. Only an **ACTIVE** broadcast within its `[startAt, endAt]` window
pre-empts playback. An `ENDED`/`ARCHIVED` broadcast cannot be re-activated (create
a new one). Targets are an `EmergencyBroadcastTarget[]` reusing the schedule
target model (SCREEN / SCREEN_GROUP / LOCATION / COMPANY).

## Priority rules

The resolver's precedence ladder is:

```
Active Emergency Broadcast   ← highest
  > Higher-priority Schedule
  > Campaign Schedule
  > Normal Schedule
  > Fallback Content          ← lowest
```

Any active emergency out-ranks **every** schedule. Among multiple simultaneous
emergencies targeting the same screen, the **highest `priority`** wins; ties break
by **newest `updatedAt`**. If the winning emergency's content is broken
(expired/archived/missing), the resolver skips to the next live emergency, and if
none yield items, falls through to the normal schedule/fallback logic.

**Working hours:** an emergency overrides working hours by default — it plays even
when the screen is "closed". (This is intentional; an incident does not respect
opening hours.)

## Target behavior & tenant isolation

Targets are expanded to concrete screens with the same engine schedules use
(`buildScreenIndex` + `expandTargets`). A `COMPANY` target means "all of this
company's screens" — its `targetId` is cosmetic because expansion and matching are
already scoped to the tenant. **Emergencies never cross tenants:** a broadcast can
only reference its own company's content/playlists and target its own company's
screens/groups/locations; invalid targets are rejected. Orientation mismatches are
**warnings only** — they never block activation.

## API (JWT; reads `screen:read`, mutations `emergency:send`)

| Method & path                                            | Purpose                                      |
| -------------------------------------------------------- | -------------------------------------------- |
| `GET /api/emergency-broadcasts`                          | List (filter by status/search)               |
| `POST /api/emergency-broadcasts`                         | Create (DRAFT)                               |
| `POST /api/emergency-broadcasts/quick-text`              | Create **and** activate a text broadcast     |
| `GET /api/emergency-broadcasts/:id`                      | Detail (+ validation, affected screens)      |
| `GET /api/emergency-broadcasts/:id/validate`             | Non-throwing validation report               |
| `PATCH /api/emergency-broadcasts/:id`                    | Update                                       |
| `POST /api/emergency-broadcasts/:id/activate`            | Go live (requires ≥1 target + valid content) |
| `POST /api/emergency-broadcasts/:id/pause`               | Pause (screens revert)                       |
| `POST /api/emergency-broadcasts/:id/end`                 | End (screens revert)                         |
| `POST /api/emergency-broadcasts/:id/archive`             | Archive (must be ended/draft)                |
| `POST /api/emergency-broadcasts/:id/targets`             | Add a target                                 |
| `DELETE /api/emergency-broadcasts/:id/targets/:targetId` | Remove a target                              |

Viewers can read what is live; only `emergency:send` (Company Admin + Location
Manager) may create/activate/end. Reboot/power and other device limits are
unchanged.

## Immediate take-effect (Phase 8 command path)

When a broadcast is **activated, updated (while live), paused, or ended**, the
service fans a `REFRESH_MANIFEST` command out to the affected paired screens
(reusing the Phase 8 `DeviceCommandService`). The device fetches a fresh manifest
and pre-empts immediately. If command delivery is missed, the normal manifest
refresh poll still catches the change shortly after — the command path is an
acceleration, not a dependency. (No WebSocket; polling delivery is sufficient.)

## Resolver output

When an emergency applies, the manifest is:

```jsonc
{ "sourceType": "EMERGENCY", "emergencyBroadcastId": "…", "priority": 100,
  "message": "…(TEXT only)", "items": [ … ], "warnings": [ …orientation… ] }
```

Direct TEXT/URL emergencies have no library `Content`, so their manifest item uses
a synthetic `contentId` (`emg:<broadcastId>`) for client-side keying; the player
reports proof-of-play with `contentId = null` for these (the FK-safe identity is
`emergencyBroadcastId`).

## Android behavior

The player treats `sourceType = EMERGENCY` like any other manifest, but because an
activation triggers a manifest refresh, the new EMERGENCY manifest replaces the
running one. On replacement:

1. The currently-playing item is closed with an **`ITEM_INTERRUPTED`**
   proof-of-play event (it never naturally completed).
2. The emergency item(s) start immediately (`ITEM_STARTED`, `sourceType =
EMERGENCY`, `emergencyBroadcastId` set) and loop while active.
3. When the emergency ends, the manifest reverts to the normal schedule/fallback;
   the emergency item is interrupted and normal playback resumes.

Offline limits (Phase 7) still apply: a file-based emergency that is not cached and
the device is offline cannot play (it streams when online; prefers the cached file
when present). TEXT emergencies always play. No special sirens/sounds unless the
content itself contains them.

## Emergency proof-of-play

Emergency playback is logged like any other playback, with `sourceType =
EMERGENCY` and `emergencyBroadcastId` set, so reports can show exactly what an
emergency displayed and for how long. Emergency plays are flagged in the
proof-of-play report table.

## How to test (Phase 9)

See **[proof-of-play.md](./proof-of-play.md)** for the PoP signal contract.

1. **Proof-of-play:** pair a screen, let it play a schedule → events appear under
   _Proof of Play_. Pull the network → on reconnect, buffered events flush (still
   accepted if within 14 days). Confirm a cross-company screen filter returns
   nothing and a Viewer can read the report.
2. **Emergency:** create a TEXT broadcast targeting the screen (or use _Quick
   text_), **Activate** → the screen pre-empts within a refresh cycle and shows the
   message even outside working hours; the in-flight item logs `ITEM_INTERRUPTED`,
   the emergency logs plays with `sourceType = EMERGENCY`. **End** → the screen
   returns to its schedule. Create two emergencies with different priorities → the
   higher one wins. Target another company's screen → rejected. Use archived content
   → rejected. Orientation mismatch → warning only.

## Handoff to Phase 10

- Alerts/notifications for emergency activation/end beyond Activity Logs (email,
  dashboard notifications) are Phase 10.
- A scheduler to auto-`END` broadcasts whose `endAt` has passed is a Phase 10
  foundation; today the resolver simply ignores a past-`endAt` emergency, so it
  stops playing even before it is formally ended.
