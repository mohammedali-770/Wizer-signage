/**
 * Browser refresh transport kept deliberately dependency-free so its security
 * contract can be tested under Node's built-in TypeScript test runner.
 */
export async function requestRefreshedAccessToken(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetcher(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { accessToken?: unknown };
    return typeof data.accessToken === 'string' && data.accessToken.length > 0
      ? data.accessToken
      : null;
  } catch {
    return null;
  }
}

/** Impersonation access tokens are intentionally non-refreshable. */
export function shouldAttemptBrowserRefresh(
  authenticatedRequest: boolean,
  impersonating: boolean,
): boolean {
  return authenticatedRequest && !impersonating;
}
