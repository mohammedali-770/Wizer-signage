export type SearchableSelectorType =
  | 'SCREEN'
  | 'SCREEN_GROUP'
  | 'LOCATION'
  | 'COMPANY'
  | 'PLAYLIST'
  | 'CONTENT'
  | 'TAG';

export type TagApplicability = 'SCREEN' | 'CONTENT';

const BASE_PATH: Record<SearchableSelectorType, string> = {
  SCREEN: '/screens',
  SCREEN_GROUP: '/screen-groups',
  LOCATION: '/locations',
  COMPANY: '/companies',
  PLAYLIST: '/playlists',
  CONTENT: '/content',
  TAG: '/tags',
};

const LABEL_FIELD: Record<SearchableSelectorType, 'name' | 'title'> = {
  SCREEN: 'name',
  SCREEN_GROUP: 'name',
  LOCATION: 'name',
  COMPANY: 'name',
  PLAYLIST: 'title',
  CONTENT: 'title',
  TAG: 'name',
};

const MAX_RESULTS = 50;

export interface SelectorEntity {
  id: string;
  name: string;
}

export interface SelectorSearchOptions {
  tagApplicability?: TagApplicability;
  /** Existing business filters that the old selector query already enforced. */
  filters?: Readonly<Record<string, string>>;
}

/**
 * A selector search is intentionally a single bounded server page, not an
 * all-pages crawl. Users can reach any entity by refining `search`, so tenant
 * size no longer creates a silent correctness ceiling or a burst of 20 GETs.
 *
 * Content and playlists are assignable resources, so their selector candidates
 * are ACTIVE by default (matching the pre-migration queries). Individual ID
 * lookup still recovers the label of an older archived selection when editing.
 */
export function selectorSearchPath(
  type: SearchableSelectorType,
  search: string,
  options?: SelectorSearchOptions,
): string {
  const params = new URLSearchParams({ page: '1', pageSize: String(MAX_RESULTS) });
  const term = search.trim();
  if (term) params.set('search', term);
  if (type === 'TAG' && options?.tagApplicability) {
    params.set('applicableTo', options.tagApplicability);
  }
  if (type === 'CONTENT' || type === 'PLAYLIST') {
    params.set('status', 'ACTIVE');
  }
  for (const [key, value] of Object.entries(options?.filters ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (key && value) params.set(key, value);
  }
  return `${BASE_PATH[type]}?${params.toString()}`;
}

export function selectorEntityPath(type: SearchableSelectorType, id: string): string {
  return `${BASE_PATH[type]}/${encodeURIComponent(id)}`;
}

/**
 * Normalize the deliberately different API list/detail shapes into one tiny
 * selector contract. Content/playlists use `title`; most resources use `name`;
 * company detail wraps the entity under `company`.
 */
export function normalizeSelectorEntity(
  type: SearchableSelectorType,
  payload: unknown,
): SelectorEntity | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const raw =
    type === 'COMPANY' && root.company && typeof root.company === 'object' && !Array.isArray(root.company)
      ? (root.company as Record<string, unknown>)
      : root;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const field = LABEL_FIELD[type];
  const label = typeof raw[field] === 'string' ? raw[field].trim() : '';
  return id && label ? { id, name: label } : null;
}

export const SELECTOR_RESULT_LIMIT = MAX_RESULTS;
