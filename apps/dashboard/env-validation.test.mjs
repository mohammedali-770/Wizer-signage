import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validatePublicApiUrl } from './env-validation.mjs';

// --- Rejections (a production build must fail on any of these) ---------------

test('rejects a missing value', () => {
  assert.throws(() => validatePublicApiUrl(undefined), /required/);
});

test('rejects a blank / whitespace-only value', () => {
  assert.throws(() => validatePublicApiUrl(''), /required/);
  assert.throws(() => validatePublicApiUrl('   '), /required/);
});

test('rejects localhost / loopback hosts', () => {
  assert.throws(() => validatePublicApiUrl('https://localhost:3001/api'), /disallowed host/);
  assert.throws(() => validatePublicApiUrl('https://127.0.0.1/api'), /disallowed host/);
  assert.throws(() => validatePublicApiUrl('https://[::1]/api'), /disallowed host/);
  assert.throws(() => validatePublicApiUrl('https://0.0.0.0/api'), /disallowed host/);
});

test('rejects a non-HTTPS URL', () => {
  assert.throws(() => validatePublicApiUrl('http://api.example.com/api'), /must use https/);
});

test('rejects a wildcard host', () => {
  assert.throws(() => validatePublicApiUrl('https://*.example.com/api'), /disallowed host/);
});

test('rejects a malformed URL', () => {
  assert.throws(() => validatePublicApiUrl('not-a-url'), /not a valid URL/);
  assert.throws(() => validatePublicApiUrl('https://'), /not a valid URL/);
});

test('rejects embedded credentials', () => {
  assert.throws(
    () => validatePublicApiUrl('https://user:pass@api.example.com/api'),
    /credentials/,
  );
});

test('rejects a query string or fragment', () => {
  assert.throws(() => validatePublicApiUrl('https://api.example.com/api?x=1'), /query string/);
  assert.throws(() => validatePublicApiUrl('https://api.example.com/api#frag'), /fragment/);
});

// --- Acceptances -------------------------------------------------------------

test('accepts a valid absolute HTTPS API base with a path', () => {
  assert.equal(
    validatePublicApiUrl('https://api.example.com/api'),
    'https://api.example.com/api',
  );
});

test('accepts an HTTPS origin with a port', () => {
  assert.equal(
    validatePublicApiUrl('https://api.example.com:8443/api'),
    'https://api.example.com:8443/api',
  );
});

test('normalises a trailing slash', () => {
  assert.equal(
    validatePublicApiUrl('https://api.example.com/api/'),
    'https://api.example.com/api',
  );
});
