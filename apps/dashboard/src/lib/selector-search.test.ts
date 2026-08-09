import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SELECTOR_RESULT_LIMIT,
  normalizeSelectorEntity,
  selectorEntityPath,
  selectorSearchPath,
} from './selector-search.ts';

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

  it('maps scalable entity types to their server endpoints', () => {
    assert.match(selectorSearchPath('LOCATION', 'Riyadh'), /^\/locations\?/);
    assert.match(selectorSearchPath('COMPANY', 'Acme'), /^\/companies\?/);
    assert.match(selectorSearchPath('PLAYLIST', 'Breakfast'), /^\/playlists\?/);
    assert.match(selectorSearchPath('CONTENT', 'Promo'), /^\/content\?/);
    assert.match(selectorSearchPath('TAG', 'Lobby'), /^\/tags\?/);
  });

  it('passes selector-safe tag applicability to the API', () => {
    assert.equal(
      selectorSearchPath('TAG', 'promo', { tagApplicability: 'CONTENT' }),
      `/tags?page=1&pageSize=${SELECTOR_RESULT_LIMIT}&search=promo&applicableTo=CONTENT`,
    );
    assert.equal(
      selectorSearchPath('TAG', '', { tagApplicability: 'SCREEN' }),
      `/tags?page=1&pageSize=${SELECTOR_RESULT_LIMIT}&applicableTo=SCREEN`,
    );
  });

  it('ignores tag applicability for non-tag selectors', () => {
    assert.equal(
      selectorSearchPath('SCREEN', 'Lobby', { tagApplicability: 'CONTENT' }),
      `/screens?page=1&pageSize=${SELECTOR_RESULT_LIMIT}&search=Lobby`,
    );
  });

  it('encodes ids used for individual selected-label resolution', () => {
    assert.equal(selectorEntityPath('SCREEN', 'a/b'), '/screens/a%2Fb');
  });

  it('normalizes name and title resources without leaking API shape differences', () => {
    assert.deepEqual(normalizeSelectorEntity('SCREEN', { id: 's1', name: 'Lobby TV' }), {
      id: 's1',
      name: 'Lobby TV',
    });
    assert.deepEqual(normalizeSelectorEntity('PLAYLIST', { id: 'p1', title: 'Breakfast' }), {
      id: 'p1',
      name: 'Breakfast',
    });
    assert.deepEqual(normalizeSelectorEntity('CONTENT', { id: 'c1', title: 'Promo' }), {
      id: 'c1',
      name: 'Promo',
    });
  });

  it('unwraps company detail responses for selected-label recovery', () => {
    assert.deepEqual(
      normalizeSelectorEntity('COMPANY', { company: { id: 'co1', name: 'Acme' }, usage: {} }),
      { id: 'co1', name: 'Acme' },
    );
  });

  it('fails closed on malformed selector payloads', () => {
    assert.equal(normalizeSelectorEntity('SCREEN', { id: 's1' }), null);
    assert.equal(normalizeSelectorEntity('CONTENT', { id: 'c1', title: '' }), null);
    assert.equal(normalizeSelectorEntity('TAG', null), null);
  });
});
