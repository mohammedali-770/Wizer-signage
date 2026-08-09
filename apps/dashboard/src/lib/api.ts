/**
 * Typed API client for the Wizer Signage backend.
 *
 * - Attaches the short-lived access token, transparently refreshes once on a
 *   401, and surfaces the platform error envelope as ApiError.
 * - The ACCESS token lives in localStorage (browser only). The refresh token
 *   never enters JavaScript: the API stores/rotates it in an HttpOnly cookie
 *   scoped to /api/auth/refresh.
 */

import { API_BASE_URL } from './api-base';
import { invalidateApiCache } from './api-cache';
import { endImpersonation, isImpersonating } from './impersonation';
import { requestRefreshedAccessToken, shouldAttemptBrowserRefresh } from './refresh-client';

const BASE = API_BASE_URL;

const ACCESS_KEY = 'ms_access_token';
// Removed from the active design. Kept only so an upgraded browser deletes the
// pre-cookie value left by an older build rather than carrying a bearer secret
// in localStorage indefinitely.
const LEGACY_REFRESH_KEY = 'ms_refresh_token';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function setTokens(accessToken: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACCESS_KEY, accessToken);
  // One-way migration from the old localStorage refresh-token design.
  window.localStorage.removeItem(LEGACY_REFRESH_KEY);
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(LEGACY_REFRESH_KEY);
}

export function hasSession(): boolean {
  return !!getAccessToken();
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  // An impersonation token is deliberately non-refreshable. The administrator's
  // ordinary refresh cookie still exists (HttpOnly, so JS cannot stash/remove
  // it), therefore calling /auth/refresh while impersonating would silently
  // switch identity back to the admin session. Never cross that audit boundary.
  if (!shouldAttemptBrowserRefresh(true, isImpersonating())) return false;

  const accessToken = await requestRefreshedAccessToken(BASE);
  if (!accessToken) return false;
  setTokens(accessToken);
  return true;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Set false for endpoints that must not send the access token (login, refresh). */
  auth?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = getAccessToken();
    if (options.auth !== false && token) headers.authorization = `Bearer ${token}`;
    return fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      // Required for the browser to accept the Set-Cookie on login/2FA and send
      // the scoped HttpOnly cookie to /auth/refresh when API and dashboard use
      // different origins (e.g. localhost ports or a dedicated API host).
      credentials: 'include',
    });
  };

  let res = await send();

  if (
    res.status === 401 &&
    shouldAttemptBrowserRefresh(options.auth !== false, isImpersonating())
  ) {
    refreshing = refreshing ?? refreshTokens();
    const ok = await refreshing;
    refreshing = null;
    if (ok) res = await send();
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const error = (json && json.error) || { code: 'ERROR', message: res.statusText };
    if (res.status === 401) handleUnauthorized();
    throw new ApiError(error.code, error.message, res.status);
  }
  return json as T;
}

/** Multipart upload (FormData) — same auth/refresh handling as apiFetch. */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {}; // let the browser set the multipart boundary
    const token = getAccessToken();
    if (token) headers.authorization = `Bearer ${token}`;
    return fetch(`${BASE}${path}`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });
  };

  let res = await send();
  if (res.status === 401 && shouldAttemptBrowserRefresh(true, isImpersonating())) {
    refreshing = refreshing ?? refreshTokens();
    const ok = await refreshing;
    refreshing = null;
    if (ok) res = await send();
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = (json && json.error) || { code: 'ERROR', message: res.statusText };
    if (res.status === 401) handleUnauthorized();
    throw new ApiError(error.code, error.message, res.status);
  }
  return json as T;
}

/**
 * A 401 means the token in hand is finished. What that implies depends on WHICH
 * token it is: an expired impersonation should drop the admin back into their
 * own session rather than logging them out of the platform entirely, which is
 * what clearing everything would do.
 */
function handleUnauthorized(): void {
  if (isImpersonating()) {
    endImpersonation();
  } else {
    clearTokens();
  }
  // Drop cached data tied to the now-invalid session (defense-in-depth).
  invalidateApiCache();
  // Tell the app the session is gone. Clearing the tokens alone leaves the SPA
  // rendering a fully-populated console it can no longer refresh: an admin who
  // revokes a session, a suspended company, or a password changed in another
  // tab all left the user looking at stale data until they happened to reload.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_INVALIDATED_EVENT));
  }
}

/** Fired on `window` when a request proves the stored session is no longer valid. */
export const SESSION_INVALIDATED_EVENT = 'wizer:session-invalidated';

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => apiUpload<T>(path, formData),
};
