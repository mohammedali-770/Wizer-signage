/**
 * Per-route-group message slicing.
 *
 * The locale layout shipped the WHOLE catalogue to every route: 83 KB of `en`
 * and 113 KB of `ar`, serialised into the RSC payload of every page. The login
 * screen renders six strings and was paying for all 45 page namespaces plus the
 * entire marketing site.
 *
 * The slices below are deliberately coarse — one per route group, not one per
 * page. A per-page map would be 45 entries that nobody updates, and the failure
 * mode of a stale entry is raw translation keys rendered to a user. Route groups
 * change about once a quarter, and `messages.test.ts` derives the namespaces
 * each group actually uses FROM THE SOURCE and fails if a slice is missing one,
 * so the mapping cannot silently rot.
 */

export type Messages = Record<string, unknown>;

/**
 * Namespaces every route needs: the shell, nav, theme, locale switcher,
 * notifications and the shared `enums`/`common` dictionaries.
 *
 * `pages` entries listed here belong to components rendered outside any one
 * group (the fallback picker, the notification centre, the working-hours
 * editor) plus the two routes that have no group layout of their own — login
 * and accept-invitation. Both are small, and giving them their own provider
 * would cost more than it saves.
 */
const SHARED_PAGE_NAMESPACES = [
  'fallbackPicker',
  'notificationCenter',
  'workingHours',
  'login',
  'acceptInvite',
] as const;

/** Route groups that get their own slice, keyed by URL segment. */
export type RouteGroup = 'marketing' | 'admin' | 'company';

function pickPages(messages: Messages, keep: (key: string) => boolean): Messages {
  const pages = (messages.pages ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pages)) {
    if (keep(key)) out[key] = value;
  }
  return out;
}

/** Everything except `pages` and `marketing`, plus the shared page namespaces. */
export function sharedMessages(messages: Messages): Messages {
  const out: Messages = {};
  for (const [key, value] of Object.entries(messages)) {
    if (key === 'pages' || key === 'marketing') continue;
    out[key] = value;
  }
  out.pages = pickPages(messages, (k) => (SHARED_PAGE_NAMESPACES as readonly string[]).includes(k));
  return out;
}

/**
 * The shared slice plus one group's own namespaces.
 *
 * Returns the UNION rather than just the extras because a nested
 * `NextIntlClientProvider` replaces its parent's messages rather than merging
 * with them. The shared slice is therefore serialised twice on group routes —
 * ~16 KB of `en` — which is the price of not needing a middleware-supplied
 * pathname in the root layout. Still a large net win: an admin page drops from
 * 83 KB to 46 KB, and login, which has no group layout, drops to 16 KB.
 */
export function messagesForGroup(messages: Messages, group: RouteGroup): Messages {
  const shared = sharedMessages(messages);
  const sharedPages = shared.pages as Record<string, unknown>;

  if (group === 'marketing') {
    return { ...shared, marketing: messages.marketing ?? {} };
  }

  const isAdmin = (key: string) => key.startsWith('admin');
  const groupPages = pickPages(messages, (key) =>
    group === 'admin' ? isAdmin(key) : !isAdmin(key),
  );

  return { ...shared, pages: { ...sharedPages, ...groupPages } };
}
