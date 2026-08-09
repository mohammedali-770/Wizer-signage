import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildContentSecurityPolicy } from './csp.ts';

describe('buildContentSecurityPolicy', () => {
  it('uses a nonce for scripts and never permits unsafe-inline JavaScript', () => {
    const policy = buildContentSecurityPolicy({
      nonce: 'request-nonce',
      apiUrl: 'https://signage.wizer.sa/api',
      development: false,
    });

    assert.match(policy, /script-src 'self' 'nonce-request-nonce' 'strict-dynamic'/);
    assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /base-uri 'self'/);
    assert.match(policy, /form-action 'self'/);
    assert.match(policy, /upgrade-insecure-requests/);
  });

  it('limits API connections to the configured API origin', () => {
    const policy = buildContentSecurityPolicy({
      nonce: 'n',
      apiUrl: 'https://api.example.test/api/v1?ignored=true',
    });

    assert.match(policy, /connect-src 'self' https:\/\/api\.example\.test/);
    assert.doesNotMatch(policy, /connect-src[^;]*\/api\/v1/);
  });

  it('fails closed to same-origin connections when API configuration is invalid', () => {
    const policy = buildContentSecurityPolicy({ nonce: 'n', apiUrl: 'javascript:alert(1)' });
    assert.match(policy, /connect-src 'self'(?:;|$)/);
    assert.doesNotMatch(policy, /javascript:/);
  });

  it('adds only the development allowances required by Next debugging', () => {
    const policy = buildContentSecurityPolicy({ nonce: 'n', development: true });
    assert.match(policy, /script-src[^;]*'unsafe-eval'/);
    assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
    assert.doesNotMatch(policy, /upgrade-insecure-requests/);
  });
});
