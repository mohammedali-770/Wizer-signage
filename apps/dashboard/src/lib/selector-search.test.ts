import { describe, expect, it } from 'vitest';

import { SELECTOR_RESULT_LIMIT, selectorEntityPath, selectorSearchPath } from './selector-search';

describe('selector server search paths', () => {
  it('uses one bounded first page when the query is empty', () => {
    expect(selectorSearchPath('SCREEN', '')).toBe(`/screens?page=1&pageSize=${SELECTOR_RESULT_LIMIT}`);
  });

  it('trims and URL-encodes the server search term', () => {
    expect(selectorSearchPath('SCREEN_GROUP', '  Lobby & Café  ')).toBe(
      `/screen-groups?page=1&pageSize=${SELECTOR_RESULT_LIMIT}&search=Lobby+%26+Caf%C3%A9`,
    );
  });

  it('maps locations to the location API', () => {
    expect(selectorSearchPath('LOCATION', 'Riyadh')).toContain('/locations?');
  });

  it('encodes ids used for individual selected-label resolution', () => {
    expect(selectorEntityPath('SCREEN', 'a/b')).toBe('/screens/a%2Fb');
  });
});
