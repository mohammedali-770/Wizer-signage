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
 * The refresh token is now HttpOnly and is not observable here. The browser-side
 * contract is therefore smaller: stash/restore only the administrator access
 * token, and make sure any legacy localStorage refresh credentials are erased.
 * api.ts separately owns the critical rule that refresh is never attempted while
 * impersonation is active.
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
const LEGACY_REFRESH = 'ms_refresh_token';
const ADMIN_ACCESS = 'ms_admin_access_token';
const LEGACY_ADMIN_REFRESH = 'ms_admin_refresh_token';
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
  it('stashes the admin access token and installs the tenant-scoped one', () => {
    storage.setItem(ACCESS, 'admin-access');

    beginImpersonation('tenant-access', tenant);

    assert.equal(storage.getItem(ACCESS), 'tenant-access');
    assert.equal(storage.getItem(ADMIN_ACCESS), 'admin-access');
  });

  it('removes legacy refresh-token secrets left by an older dashboard build', () => {
    storage.setItem(LEGACY_REFRESH, 'old-admin-refresh');
    storage.setItem(LEGACY_ADMIN_REFRESH, 'older-stashed-refresh');

    beginImpersonation('tenant-access', tenant);

    assert.equal(storage.getItem(LEGACY_REFRESH), null);
    assert.equal(storage.getItem(LEGACY_ADMIN_REFRESH), null);
  });

  it('records the state so the banner and api refresh guard can see it', () => {
    beginImpersonation('tenant-access', tenant);
    assert.deepEqual(JSON.parse(storage.getItem(STATE) as string), tenant);
    assert.equal(isImpersonating(), true);
  });

  it('does not throw when there is no admin session to stash', () => {
    assert.doesNotThrow(() => beginImpersonation('tenant-access', tenant));
    assert.equal(storage.getItem(ACCESS), 'tenant-access');
    assert.equal(storage.getItem(ADMIN_ACCESS), null);
  });
});

describe('endImpersonation', () => {
  it("restores the admin's access token and reports success", () => {
    storage.setItem(ACCESS, 'admin-access');
    beginImpersonation('tenant-access', tenant);

    assert.equal(endImpersonation(), true);
    assert.equal(storage.getItem(ACCESS), 'admin-access');
  });

  it('clears every JavaScript-visible trace of the impersonation', () => {
    storage.setItem(ACCESS, 'admin-access');
    storage.setItem(LEGACY_REFRESH, 'old-refresh');
    beginImpersonation('tenant-access', tenant);
    endImpersonation();

    assert.equal(storage.getItem(STATE), null);
    assert.equal(storage.getItem(ADMIN_ACCESS), null);
    assert.equal(storage.getItem(LEGACY_REFRESH), null);
    assert.equal(storage.getItem(LEGACY_ADMIN_REFRESH), null);
    assert.equal(isImpersonating(), false);
  });

  it('reports failure and leaves no dead access token when there is nothing to restore', () => {
    storage.setItem(ACCESS, 'tenant-access');
    storage.setItem(STATE, JSON.stringify(tenant));

    assert.equal(endImpersonation(), false);
    assert.equal(storage.getItem(ACCESS), null);
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
    setWindow(null);
    assert.doesNotThrow(() => beginImpersonation('tenant-access', tenant));
    assert.equal(getImpersonation(), null);
    assert.equal(isImpersonating(), false);
    assert.equal(endImpersonation(), false);
  });
});
