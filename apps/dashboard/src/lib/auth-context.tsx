'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  api,
  ApiError,
  clearTokens,
  hasSession,
  setTokens,
  SESSION_INVALIDATED_EVENT,
} from './api';
import { invalidateApiCache } from './use-api';
import type { AuthUser, MeResponse } from './types';

type Status = 'loading' | 'unauthenticated' | 'authenticated';

export type LoginResult =
  | { next: 'authenticated' }
  | { next: 'enroll' }
  | { next: '2fa'; challengeToken: string };

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

interface AuthContextValue {
  status: Status;
  user: AuthUser | null;
  me: MeResponse | null;
  /** Authenticated, but a mandatory 2FA enrolment is still pending. */
  needsTwoFactorSetup: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<void>;
  /**
   * Both enrolment calls re-authenticate: a session token alone no longer
   * authorises changing the second factor. `currentCode` is needed only when
   * 2FA is already on (re-enrolling onto a new phone).
   */
  beginEnrollment: (password: string, currentCode?: string) => Promise<TwoFactorSetup>;
  completeEnrollment: (code: string, password: string, currentCode?: string) => Promise<string[]>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await api.get<MeResponse>('/auth/me');
      setMe(next);
      setStatus('authenticated');
    } catch (e) {
      // Only a genuine auth failure (401/403) logs the user out and clears
      // tokens. Transient errors (5xx/network) keep the stored access token so
      // a later retry can recover instead of forcing a re-login.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        clearTokens();
      }
      setMe(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    if (hasSession()) {
      void reload();
    } else {
      setStatus('unauthenticated');
    }
  }, [reload]);

  // A session can die while the app is open — an admin revokes it, the company
  // is suspended, the password is changed in another tab. `apiFetch` already
  // clears the access token on a 401, but nothing told the UI, so the console
  // kept rendering data it could no longer refresh. Flipping to unauthenticated
  // makes both shells redirect to /login on their existing effect.
  useEffect(() => {
    const onInvalidated = () => {
      setMe(null);
      setStatus('unauthenticated');
    };
    window.addEventListener(SESSION_INVALIDATED_EVENT, onInvalidated);
    return () => window.removeEventListener(SESSION_INVALIDATED_EVENT, onInvalidated);
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const res = await api.post<{
        requiresTwoFactor?: boolean;
        challengeToken?: string;
        accessToken?: string;
        mustEnableTwoFactor?: boolean;
      }>('/auth/login', { email, password }, { auth: false });

      if (res.requiresTwoFactor && res.challengeToken) {
        return { next: '2fa', challengeToken: res.challengeToken };
      }
      setTokens(res.accessToken!);
      // Start the new session with a clean cache. The refresh token is already
      // stored by the browser as an HttpOnly cookie from the login response.
      invalidateApiCache();
      await reload();
      return { next: res.mustEnableTwoFactor ? 'enroll' : 'authenticated' };
    },
    [reload],
  );

  const verifyTwoFactor = useCallback(
    async (challengeToken: string, code: string) => {
      const res = await api.post<{ accessToken: string }>(
        '/auth/login/2fa',
        { challengeToken, code },
        { auth: false },
      );
      setTokens(res.accessToken);
      // Start the new session with a clean cache (same as login()).
      invalidateApiCache();
      await reload();
    },
    [reload],
  );

  const beginEnrollment = useCallback(
    (password: string, currentCode?: string) =>
      api.post<TwoFactorSetup>('/auth/2fa/setup', { password, currentCode }),
    [],
  );

  const completeEnrollment = useCallback(
    async (code: string, password: string, currentCode?: string) => {
      const res = await api.post<{ backupCodes: string[] }>('/auth/2fa/enable', {
        code,
        password,
        currentCode,
      });
      await reload();
      return res.backupCodes;
    },
    [reload],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // ignore — clear locally regardless. The server-side session will expire
      // and the refresh cookie is scoped so it cannot authenticate other paths.
    }
    clearTokens();
    // Drop all cached GET responses so a different user logging in on the same
    // tab never sees the previous session's data.
    invalidateApiCache();
    setMe(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: me?.user ?? null,
      me,
      needsTwoFactorSetup: !!me && me.twoFactorRequired && !me.mfaSatisfied,
      login,
      verifyTwoFactor,
      beginEnrollment,
      completeEnrollment,
      logout,
      reload,
    }),
    [status, me, login, verifyTwoFactor, beginEnrollment, completeEnrollment, logout, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>.');
  return ctx;
}
