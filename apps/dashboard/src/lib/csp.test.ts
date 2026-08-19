import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('CSP layering with the production proxy', () => {
  /**
   * Nginx sends its own Content-Security-Policy alongside this one. `add_header`
   * APPENDS rather than replaces, so a browser behind the production proxy
   * receives two policies and enforces BOTH — the effective policy is their
   * intersection, directive by directive.
   *
   * Verified against the real proxy: a request for /en/login came back with two
   * content-security-policy headers, and the EN/AR browser smoke passes through
   * it because nginx only repeats directives this policy already sets, with
   * identical values.
   *
   * That agreement is what this pins. Loosening one of the shared directives
   * here — a payment redirect widening form-action, an embed widening
   * frame-ancestors — would still pass this app's own tests and nginx's config
   * tests, because each side only ever checks itself. The stricter nginx copy
   * would silently win, and the failure would appear only in production behind
   * the proxy.
   */
  const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
  const template = readFileSync(
    join(repoRoot, 'infra', 'nginx', 'templates-blue-green', 'wizer-signage.conf.template'),
    'utf8',
  );

  it('sets every directive the proxy also sends, with the same value', () => {
    const proxyPolicy = /add_header\s+Content-Security-Policy\s+"([^"]+)"/.exec(template)?.[1];
    assert.ok(proxyPolicy, 'the blue/green nginx template no longer sets a CSP header');

    const appPolicy = buildContentSecurityPolicy({
      nonce: 'n',
      apiUrl: 'https://signage.wizer.sa/api',
      development: false,
    });
    const appDirectives = new Set(
      appPolicy
        .split(';')
        .map((directive) => directive.trim())
        .filter(Boolean),
    );

    for (const directive of proxyPolicy
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)) {
      assert.ok(
        appDirectives.has(directive),
        `nginx enforces "${directive}" but this policy does not set it identically, so the ` +
          `proxy's stricter copy would win in production. Change both or neither.`,
      );
    }
  });
});
