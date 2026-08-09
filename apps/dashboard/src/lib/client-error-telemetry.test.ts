import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildClientErrorPayload,
  clientErrorFingerprint,
  sanitizeClientErrorMessage,
  sanitizeClientErrorSource,
} from './client-error-telemetry.ts';

describe('client error telemetry', () => {
  it('scrubs URLs emails and long numeric identifiers before upload', () => {
    const message = sanitizeClientErrorMessage(
      'Failed for user@example.com order 123456789 at https://example.com/private?token=x',
    );
    assert.equal(
      message,
      'Failed for <email> order <number> at <url>',
    );
  });

  it('sends only a source pathname without query or origin', () => {
    assert.equal(
      sanitizeClientErrorSource('https://signage.wizer.sa/_next/static/chunk.js?secret=no#x'),
      '/_next/static/chunk.js',
    );
  });

  it('uses a deterministic 24-character lowercase hex fingerprint', () => {
    const a = clientErrorFingerprint('same error');
    const b = clientErrorFingerprint('same error');
    const c = clientErrorFingerprint('different error');
    assert.equal(a, b);
    assert.match(a, /^[a-f0-9]{24}$/);
    assert.notEqual(a, c);
  });

  it('builds the bounded API payload without stack traces', () => {
    const error = new Error('boom for person@example.com');
    error.stack = 'SECRET STACK SHOULD NOT BE SENT';
    const payload = buildClientErrorPayload(
      'WINDOW_ERROR',
      error,
      'https://signage.wizer.sa/_next/static/a.js?x=1',
      12,
      3,
    );
    assert.equal(payload.message, 'Error: boom for <email>');
    assert.equal(payload.source, '/_next/static/a.js');
    assert.equal(payload.line, 12);
    assert.equal(payload.column, 3);
    assert.equal('stack' in payload, false);
  });
});
