/**
 * Typed API client for the MasterSignage backend.
 *
 * - Attaches the access token, transparently refreshes once on a 401, and
 *   surfaces the platform error envelope `{ success:false, error }` as ApiError.
 * - Tokens live in localStorage (browser only); all access is SSR-guarded.
 */

import { invalidateApiCache } from './api-cache';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const ACCESS_KEY = 'ms_access_token';
const REFRESH_KEY = 'ms_refresh_token';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACCESS_KEY, accessToken);
  window.localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

export function hasSession(): boolean {
  return !!getAccessToken();
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
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
    });
  };

  let res = await send();

  if (res.status === 401 && options.auth !== false && getRefreshToken()) {
    refreshing = refreshing ?? refreshTokens();
    const ok = await refreshing;
    refreshing = null;
    if (ok) res = await send();
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const error = (json && json.error) || { code: 'ERROR', message: res.statusText };
    if (res.status === 401) {
      clearTokens();
      // Drop cached data tied to the now-invalid session (defense-in-depth).
      invalidateApiCache();
    }
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
    return fetch(`${BASE}${path}`, { method: 'POST', headers, body: formData });
  };

  let res = await send();
  if (res.status === 401 && getRefreshToken()) {
    refreshing = refreshing ?? refreshTokens();
    const ok = await refreshing;
    refreshing = null;
    if (ok) res = await send();
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = (json && json.error) || { code: 'ERROR', message: res.statusText };
    if (res.status === 401) {
      clearTokens();
      // Drop cached data tied to the now-invalid session (defense-in-depth).
      invalidateApiCache();
    }
    throw new ApiError(error.code, error.message, res.status);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => apiUpload<T>(path, formData),
};
