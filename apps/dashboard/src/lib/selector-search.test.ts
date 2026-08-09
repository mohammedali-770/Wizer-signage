import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SELECTOR_RESULT_LIMIT, selectorEntityPath, selectorSearchPath } from './selector-search.ts';

describe('selector server search paths', () => {
  it('uses one bounded first page when the query is empty', () => {
    assert.equal(
      selectorSearchPath('SCREEN', ''),
      `/screens?page=1&pageSize=${SELECTOR_RESULT_LIMIT}`,
    );
  });

  it('trims and URL-encodes the server search term', () => {
    assert.equal(
      selectorSearchPath('SCREEN_GROUP', '  Lobby & Café  '),
      `/screen-groups?page=1&pageSize=${SELECTOR_RESULT_LIMIT}&search=Lobby+%26+Caf%C3%A9`,
    );
  });

  it('maps locations to the location API', () => {
    assert.match(selectorSearchPath('LOCATION', 'Riyadh'), /^\/locations\?/);
  });

  it('encodes ids used for individual selected-label resolution', () => {
    assert.equal(selectorEntityPath('SCREEN', 'a/b'), '/screens/a%2Fb');
  });
});
