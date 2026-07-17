/**
 * Single source of truth for the browser-facing API base URL.
 *
 * `NEXT_PUBLIC_API_URL` is inlined at BUILD time by Next.js, so this resolves to
 * a constant in the client bundle. A **production build fails** when the var is
 * missing or unsafe (validated in ../../next.config.mjs + ../../env-validation.mjs),
 * so in every production bundle the var is guaranteed present and valid here.
 *
 * The fallback below therefore exists ONLY for the local dev server (`next dev`,
 * which is never a production build): it points at the local API. There is no
 * production fallback and no hardcoded production domain — pointing browsers at a
 * guessed host is worse than failing loudly, and the build gate already prevents
 * a missing value from reaching production.
 *
 * Import `API_BASE_URL` everywhere instead of re-reading
 * `process.env.NEXT_PUBLIC_API_URL`, so this decision lives in exactly one place.
 */

const DEV_API_BASE_URL = 'http://localhost:3001/api';

function resolveApiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  if (fromEnv && fromEnv.trim() !== '') {
    return fromEnv;
  }

  // Reached only when the build-time gate did not run (i.e. the dev server) or a
  // misconfiguration slipped through. Never guess a production host.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set in this production build; it must be provided at build time.',
    );
  }
  return DEV_API_BASE_URL;
}

export const API_BASE_URL: string = resolveApiBaseUrl();
