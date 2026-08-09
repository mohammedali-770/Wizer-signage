import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { apiFetch, getAccessToken, setTokens } from './api.ts';
import { beginImpersonation, isImpersonating } from './impersonation.ts';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}

let storage: MemoryStorage;
let originalFetch: typeof globalThis.fetch;

function installWindow(): void {
  const eventTarget = new EventTarget();
  const browser = {
    localStorage: storage,
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
  };
  (globalThis as unknown as { window: typeof browser }).window = browser;
}

beforeEach(() => {
  storage = new MemoryStorage();
  installWindow();
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('cookie-backed refresh', () => {
  it('refreshes with credentials, sends no refresh-token body, and stores only the new access token', async () => {
    storage.setItem('ms_refresh_token', 'legacy-secret-must-disappear');
    setTokens('old-access');

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/auth/refresh')) {
        return new Response(JSON.stringify({ accessToken: 'new-access' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const resourceCalls = calls.filter((call) => call.url.endsWith('/screens')).length;
      if (resourceCalls === 1) {
        return new Response(JSON.stringify({ error: { code: 'TOKEN_EXPIRED', message: 'expired' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await apiFetch<{ ok: boolean }>('/screens');
    assert.deepEqual(result, { ok: true });
    assert.equal(getAccessToken(), 'new-access');
    assert.equal(storage.getItem('ms_refresh_token'), null);

    const refresh = calls.find((call) => call.url.endsWith('/auth/refresh'));
    assert.ok(refresh, 'expected one cookie refresh request');
    assert.equal(refresh.init?.credentials, 'include');
    assert.equal(refresh.init?.body, undefined);
    assert.equal(calls.filter((call) => call.url.endsWith('/auth/refresh')).length, 1);
  });

  it('never calls /auth/refresh while impersonating, even though the admin cookie may still exist', async () => {
    setTokens('admin-access');
    beginImpersonation('tenant-access', {
      companyId: 'tenant-1',
      companyName: 'Tenant One',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(isImpersonating(), true);

    const urls: string[] = [];
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ error: { code: 'TOKEN_EXPIRED', message: 'expired' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await assert.rejects(() => apiFetch('/screens'));
    assert.equal(urls.some((url) => url.endsWith('/auth/refresh')), false);
    // handleUnauthorized ends the impersonation and restores the admin access
    // token. Only AFTER this boundary is gone may a later request refresh it.
    assert.equal(isImpersonating(), false);
    assert.equal(getAccessToken(), 'admin-access');
  });
});
