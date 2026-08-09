/**
 * Client-side state for an audited super-admin impersonation.
 *
 * The API issues a short-lived access token scoped to the target tenant and
 * deliberately issues NO refresh token for the impersonation itself. The
 * administrator's ordinary refresh token now lives in an HttpOnly cookie, so
 * JavaScript cannot (and must not try to) move it around.
 *
 * `api.ts` therefore enforces the critical boundary: while impersonation is
 * active, a 401 NEVER calls /auth/refresh. That prevents the still-present admin
 * refresh cookie from silently swapping an expired tenant token back into the
 * administrator identity. This module only stashes/restores the admin ACCESS
 * token and records the visible impersonation state.
 */

const ACCESS_KEY = 'ms_access_token';
const LEGACY_REFRESH_KEY = 'ms_refresh_token';
const ADMIN_ACCESS_KEY = 'ms_admin_access_token';
const LEGACY_ADMIN_REFRESH_KEY = 'ms_admin_refresh_token';
const STATE_KEY = 'ms_impersonation';

export interface ImpersonationState {
  companyId: string;
  companyName: string;
  /** ISO-8601; the token is worthless after this instant. */
  expiresAt: string;
}

function store(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

/** Enter impersonation: stash the admin access token and install the tenant one. */
export function beginImpersonation(accessToken: string, state: ImpersonationState): void {
  const s = store();
  if (!s) return;

  const adminAccess = s.getItem(ACCESS_KEY);
  if (adminAccess) s.setItem(ADMIN_ACCESS_KEY, adminAccess);

  // One-way cleanup for browsers upgrading from the pre-cookie design. The
  // active refresh credential is HttpOnly and cannot be reached from here.
  s.removeItem(LEGACY_REFRESH_KEY);
  s.removeItem(LEGACY_ADMIN_REFRESH_KEY);

  s.setItem(ACCESS_KEY, accessToken);
  s.setItem(STATE_KEY, JSON.stringify(state));
}

/**
 * Leave impersonation and put the administrator's access token back.
 *
 * Returns false when there was nothing to restore — the admin's own access
 * token had already disappeared — so the caller can send them to login. If the
 * restored access token later expires, api.ts may use the admin's HttpOnly
 * refresh cookie again because the impersonation state has been cleared.
 */
export function endImpersonation(): boolean {
  const s = store();
  if (!s) return false;

  const adminAccess = s.getItem(ADMIN_ACCESS_KEY);

  s.removeItem(STATE_KEY);
  s.removeItem(ADMIN_ACCESS_KEY);
  s.removeItem(LEGACY_REFRESH_KEY);
  s.removeItem(LEGACY_ADMIN_REFRESH_KEY);

  if (!adminAccess) {
    s.removeItem(ACCESS_KEY);
    return false;
  }

  s.setItem(ACCESS_KEY, adminAccess);
  return true;
}

/**
 * The current impersonation, or null.
 *
 * An expired impersonation reads as null: the token is already worthless, so
 * continuing to show the banner would misrepresent what the next request will
 * do. Malformed state is treated the same way rather than thrown — a corrupt
 * localStorage entry must not make the whole console unrenderable.
 */
export function getImpersonation(now: number = Date.now()): ImpersonationState | null {
  const raw = store()?.getItem(STATE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ImpersonationState>;
    if (!parsed?.companyId || !parsed.expiresAt) return null;
    if (new Date(parsed.expiresAt).getTime() <= now) return null;
    return {
      companyId: parsed.companyId,
      companyName: parsed.companyName ?? parsed.companyId,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function isImpersonating(now: number = Date.now()): boolean {
  return getImpersonation(now) !== null;
}
