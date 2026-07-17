/**
 * Build-time validation of NEXT_PUBLIC_API_URL for the dashboard.
 *
 * `NEXT_PUBLIC_*` values are inlined into the client bundle by Next.js at BUILD
 * time, so a wrong (or silently-defaulted) value is baked into every browser and
 * cannot be corrected by restarting the container. This validator is called from
 * next.config.mjs during a production build (PHASE_PRODUCTION_BUILD) to fail the
 * BUILD — not just startup — when the public API URL is missing or unsafe.
 *
 * A production build requires an explicit, absolute HTTPS URL. Unlike a CORS
 * origin, this is an API BASE and may legitimately carry a path (e.g.
 * `https://api.example.com/api`); it must NOT carry a query, fragment, or
 * embedded credentials, and must not point at localhost/loopback.
 *
 * Errors name the variable and the reason only — never a secret. (The value is
 * a public URL, but we keep the message minimal on principle.)
 *
 * Exported as a pure function so it can be unit-tested without spawning a build.
 */

/** Hostnames that must never be baked into a production dashboard bundle. */
const FORBIDDEN_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  '::',
  '[::]',
]);

/**
 * Validate the public API base URL for a production build.
 *
 * @param {string | undefined} raw the raw NEXT_PUBLIC_API_URL value
 * @returns {string} the normalised URL (trailing slash removed)
 * @throws {Error} when the value is missing, blank, or unsafe
 */
export function validatePublicApiUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';

  if (value === '') {
    throw new Error(
      'NEXT_PUBLIC_API_URL is required for a production dashboard build (set it to your public HTTPS API base, e.g. https://api.example.com/api).',
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`NEXT_PUBLIC_API_URL is not a valid URL: "${value}".`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`NEXT_PUBLIC_API_URL must use https in production (got "${value}").`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('NEXT_PUBLIC_API_URL must not contain embedded credentials.');
  }
  if (url.search !== '') {
    throw new Error('NEXT_PUBLIC_API_URL must not contain a query string.');
  }
  if (url.hash !== '') {
    throw new Error('NEXT_PUBLIC_API_URL must not contain a fragment.');
  }

  const host = url.hostname.toLowerCase();
  if (host === '' || host.includes('*') || FORBIDDEN_HOSTS.has(host)) {
    throw new Error(`NEXT_PUBLIC_API_URL has a disallowed host: "${url.hostname}".`);
  }

  // Normalise a single trailing slash so consumers that concatenate
  // `${API_BASE_URL}${path}` never produce a double slash.
  return value.replace(/\/+$/, '');
}
