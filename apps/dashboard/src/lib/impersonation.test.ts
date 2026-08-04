import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  beginImpersonation,
  endImpersonation,
  getImpersonation,
  isImpersonating,
} from './impersonation.ts';

/**
 * Client-side impersonation state.
 *
 * The server side of impersonation is the security boundary and is covered by
 * the API suite. This covers the half that lives in the browser, where the
 * failure modes are quieter: an impersonation that silently stops being one, or
 * an admin logged out of their own console by ending it.
 *
 * The module reads `window.localStorage` on every call rather than caching it,
 * so a stub installed per test is enough — no jsdom.
 */

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}

const ACCESS = 'ms_access_token';
const REFRESH = 'ms_refresh_token';
const ADMIN_ACCESS = 'ms_admin_access_token';
const ADMIN_REFRESH = 'ms_admin_refresh_token';
const STATE = 'ms_impersonation';

let storage: MemoryStorage;

/** Install a browser-ish global. Pass null to simulate server-side rendering. */
function setWindow(s: MemoryStorage | null): void {
  const g = globalThis as unknown as { window?: { localStorage: MemoryStorage } };
  if (s === null) delete g.window;
  else g.window = { localStorage: s };
}

const future = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

const tenant = {
  companyId: 'company-1',
  companyName: 'Acme Signage',
  expiresAt: future(30 * 60_000),
};

beforeEach(() => {
  storage = new MemoryStorage();
  setWindow(storage);
});

describe('beginImpersonation', () => {
  it("stashes the admin's tokens and installs the tenant-scoped one", () => {
    storage.setItem(ACCESS, 'admin-access');
    storage.setItem(REFRESH, 'admin-refresh');

    beginImpersonation('tenant-access', tenant);

    assert.equal(storage.getItem(ACCESS), 'tenant-access');
    assert.equal(storage.getItem(ADMIN_ACCESS), 'admin-access');
    assert.equal(storage.getItem(ADMIN_REFRESH), 'admin-refresh');
  });

  it('takes the refresh token out of play', () => {
    // The important one. Left in place, the client's refresh-on-401 swaps the
    // tenant token for the admin's ordinary one: the banner disappears and the
    // session quietly stops being an impersonation — exactly the state the
    // audit trail is supposed to make impossible.
    storage.setItem(ACCESS, 'admin-access');
    storage.setItem(REFRESH, 'admin-refresh');

    beginImpersonation('tenant-access', tenant);

    assert.equal(storage.getItem(REFRESH), null);
  });

  it('records the state so the banner can render', () => {
    beginImpersonation('tenant-access', tenant);
    assert.deepEqual(JSON.parse(storage.getItem(STATE) as string), tenant);
  });

  it('does not throw when there is no admin session to stash', () => {
    assert.doesNotThrow(() => beginImpersonation('tenant-access', tenant));
    assert.equal(storage.getItem(ACCESS), 'tenant-access');
    assert.equal(storage.getItem(ADMIN_ACCESS), null);
  });
});

describe('endImpersonation', () => {
  it("restores the admin's own session and reports success", () => {
    storage.setItem(ACCESS, 'admin-access');
    storage.setItem(REFRESH, 'admin-refresh');
    beginImpersonation('tenant-access', tenant);

    assert.equal(endImpersonation(), true);
    assert.equal(storage.getItem(ACCESS), 'admin-access');
    assert.equal(storage.getItem(REFRESH), 'admin-refresh');
  });

  it('clears every trace of the impersonation', () => {
    storage.setItem(ACCESS, 'admin-access');
    beginImpersonation('tenant-access', tenant);
    endImpersonation();

    assert.equal(storage.getItem(STATE), null);
    assert.equal(storage.getItem(ADMIN_ACCESS), null);
    assert.equal(storage.getItem(ADMIN_REFRESH), null);
    assert.equal(isImpersonating(), false);
  });

  it('reports failure and leaves no dead token when there is nothing to restore', () => {
    // The admin's own session expired while they were inside a tenant. Returning
    // false is how the caller knows to send them to the login page instead of
    // leaving them holding a token that cannot work.
    storage.setItem(ACCESS, 'tenant-access');
    storage.setItem(STATE, JSON.stringify(tenant));

    assert.equal(endImpersonation(), false);
    assert.equal(storage.getItem(ACCESS), null);
    assert.equal(storage.getItem(REFRESH), null);
  });

  it('is safe to call when no impersonation is active', () => {
    assert.equal(endImpersonation(), false);
  });
});

describe('getImpersonation', () => {
  it('returns the active impersonation', () => {
    beginImpersonation('tenant-access', tenant);
    assert.deepEqual(getImpersonation(), tenant);
  });

  it('returns null once the token has expired', () => {
    // The token is already worthless; still showing the banner would
    // misrepresent what the next request does.
    const expired = { ...tenant, expiresAt: new Date(Date.now() - 1000).toISOString() };
    storage.setItem(STATE, JSON.stringify(expired));

    assert.equal(getImpersonation(), null);
    assert.equal(isImpersonating(), false);
  });

  it('treats the exact expiry instant as expired', () => {
    const at = Date.now();
    storage.setItem(STATE, JSON.stringify({ ...tenant, expiresAt: new Date(at).toISOString() }));
    assert.equal(getImpersonation(at), null);
  });

  it('honours an injected clock', () => {
    const at = Date.parse(tenant.expiresAt) - 1000;
    beginImpersonation('tenant-access', tenant);
    assert.notEqual(getImpersonation(at), null);
    assert.equal(getImpersonation(Date.parse(tenant.expiresAt) + 1000), null);
  });

  it('returns null for corrupt state rather than throwing', () => {
    // A corrupt localStorage entry must not make the whole console
    // unrenderable — every caller of this runs during render.
    for (const junk of ['not json', '{', 'null', '[]', '{"companyId":"c"}', '{"expiresAt":"x"}']) {
      storage.setItem(STATE, junk);
      assert.doesNotThrow(() => getImpersonation());
      assert.equal(getImpersonation(), null, `expected null for ${junk}`);
    }
  });

  it('falls back to the company id when the name is missing', () => {
    storage.setItem(STATE, JSON.stringify({ companyId: 'company-9', expiresAt: future(60_000) }));
    assert.equal(getImpersonation()?.companyName, 'company-9');
  });
});

describe('server-side rendering', () => {
  it('reads as "not impersonating" with no window, and never throws', () => {
    // These run during SSR too, where localStorage does not exist.
    setWindow(null);
    assert.doesNotThrow(() => beginImpersonation('tenant-access', tenant));
    assert.equal(getImpersonation(), null);
    assert.equal(isImpersonating(), false);
    assert.equal(endImpersonation(), false);
  });
});
