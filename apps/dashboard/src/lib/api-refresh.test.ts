import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  requestRefreshedAccessToken,
  shouldAttemptBrowserRefresh,
} from './refresh-client.ts';

describe('cookie-backed refresh transport', () => {
  it('uses browser credentials and sends no refresh-token body', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ accessToken: 'new-access' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const token = await requestRefreshedAccessToken('https://api.example.invalid/api', fetcher);

    assert.equal(token, 'new-access');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://api.example.invalid/api/auth/refresh');
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.equal(calls[0]?.init?.credentials, 'include');
    assert.equal(calls[0]?.init?.body, undefined);
    assert.equal(calls[0]?.init?.headers, undefined);
  });

  it('fails closed when refresh is rejected, malformed, or unavailable', async () => {
    const rejected = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    const malformed = (async () =>
      new Response(JSON.stringify({ refreshToken: 'must-not-be-consumed' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const unavailable = (async () => {
      throw new Error('network down');
    }) as typeof fetch;

    assert.equal(
      await requestRefreshedAccessToken('https://api.example.invalid/api', rejected),
      null,
    );
    assert.equal(
      await requestRefreshedAccessToken('https://api.example.invalid/api', malformed),
      null,
    );
    assert.equal(
      await requestRefreshedAccessToken('https://api.example.invalid/api', unavailable),
      null,
    );
  });
});

describe('refresh identity boundary', () => {
  it('allows refresh only for an authenticated non-impersonation request', () => {
    assert.equal(shouldAttemptBrowserRefresh(true, false), true);
    assert.equal(shouldAttemptBrowserRefresh(false, false), false);
    assert.equal(shouldAttemptBrowserRefresh(true, true), false);
    assert.equal(shouldAttemptBrowserRefresh(false, true), false);
  });
});
