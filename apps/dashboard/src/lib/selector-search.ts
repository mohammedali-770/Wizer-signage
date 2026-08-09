export type SearchableSelectorType = 'SCREEN' | 'SCREEN_GROUP' | 'LOCATION';

const BASE_PATH: Record<SearchableSelectorType, string> = {
  SCREEN: '/screens',
  SCREEN_GROUP: '/screen-groups',
  LOCATION: '/locations',
};

const MAX_RESULTS = 50;

/**
 * A selector search is intentionally a single bounded server page, not an
 * all-pages crawl. Users can reach any entity by refining `search`, so tenant
 * size no longer creates a silent correctness ceiling or a burst of 20 GETs.
 */
export function selectorSearchPath(type: SearchableSelectorType, search: string): string {
  const params = new URLSearchParams({ page: '1', pageSize: String(MAX_RESULTS) });
  const term = search.trim();
  if (term) params.set('search', term);
  return `${BASE_PATH[type]}?${params.toString()}`;
}

export function selectorEntityPath(type: SearchableSelectorType, id: string): string {
  return `${BASE_PATH[type]}/${encodeURIComponent(id)}`;
}

export const SELECTOR_RESULT_LIMIT = MAX_RESULTS;
