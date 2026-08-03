/**
 * Client-side state for an audited super-admin impersonation.
 *
 * The API issues a short-lived access token scoped to the target tenant and
 * deliberately issues NO refresh token — an impersonation expires rather than
 * being extended. That has two consequences this module exists to handle:
 *
 *  1. The admin's own tokens must survive. Overwriting them would mean ending
 *     an impersonation logs the admin out of the platform console entirely, so
 *     they are stashed and restored.
 *  2. The refresh token must be out of play for the duration. If it were left
 *     in place, the client's refresh-on-401 would quietly swap the tenant token
 *     for the admin's ordinary one — the banner would vanish and the session
 *     would silently stop being an impersonation, which is precisely the state
 *     the audit trail is supposed to make impossible.
 */

const ACCESS_KEY = 'ms_access_token';
const REFRESH_KEY = 'ms_refresh_token';
const ADMIN_ACCESS_KEY = 'ms_admin_access_token';
const ADMIN_REFRESH_KEY = 'ms_admin_refresh_token';
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

/**
 * Enter impersonation: stash the admin's tokens, install the tenant-scoped one,
 * and take the refresh token out of play.
 */
export function beginImpersonation(accessToken: string, state: ImpersonationState): void {
  const s = store();
  if (!s) return;

  const adminAccess = s.getItem(ACCESS_KEY);
  const adminRefresh = s.getItem(REFRESH_KEY);
  if (adminAccess) s.setItem(ADMIN_ACCESS_KEY, adminAccess);
  if (adminRefresh) s.setItem(ADMIN_REFRESH_KEY, adminRefresh);

  s.setItem(ACCESS_KEY, accessToken);
  s.removeItem(REFRESH_KEY);
  s.setItem(STATE_KEY, JSON.stringify(state));
}

/**
 * Leave impersonation and put the admin back where they were.
 *
 * Returns false when there was nothing to restore — the admin's own session had
 * itself expired — so the caller can send them to the login page rather than
 * leaving them holding a dead token.
 */
export function endImpersonation(): boolean {
  const s = store();
  if (!s) return false;

  const adminAccess = s.getItem(ADMIN_ACCESS_KEY);
  const adminRefresh = s.getItem(ADMIN_REFRESH_KEY);

  s.removeItem(STATE_KEY);
  s.removeItem(ADMIN_ACCESS_KEY);
  s.removeItem(ADMIN_REFRESH_KEY);

  if (!adminAccess) {
    s.removeItem(ACCESS_KEY);
    s.removeItem(REFRESH_KEY);
    return false;
  }

  s.setItem(ACCESS_KEY, adminAccess);
  if (adminRefresh) s.setItem(REFRESH_KEY, adminRefresh);
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
