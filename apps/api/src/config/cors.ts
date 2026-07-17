/**
 * CORS origin resolution + validation.
 *
 * The browser-facing CORS allowlist is the security boundary that decides which
 * web origins may call the API with credentials. It MUST be locked down in
 * production: a wildcard (or a silent default that reflects any origin) combined
 * with `credentials: true` lets any site drive an authenticated session.
 *
 * This module centralises the rules so `main.ts` can fail fast — before the HTTP
 * server ever listens — with a clear, secret-free error.
 *
 * Rules by environment:
 *   production
 *     - CORS_ORIGINS MUST be set to a non-empty, explicit allowlist.
 *     - `*` (wildcard) is rejected.
 *     - each entry must be a valid browser ORIGIN: https scheme, a real
 *       hostname, an optional port, and NOTHING else (no path beyond `/`, no
 *       query, no fragment, no user:password credentials).
 *     - localhost / loopback / unspecified hosts are rejected.
 *     - entries are normalised to their canonical origin (trailing slash and any
 *       `/` path removed) and de-duplicated.
 *   development / test
 *     - an empty CORS_ORIGINS keeps the convenient default of reflecting any
 *       origin (returned as the `['*']` sentinel).
 *     - an explicit list is honoured as-is (http + localhost allowed) so local
 *       setups can pin origins without HTTPS.
 *
 * Error messages name the variable and the reason only; they never print the
 * full environment or any secret value.
 */

/** Sentinel meaning "reflect any origin" — mapped to Nest's `origin: true`. */
export const REFLECT_ANY = '*';

/** Hostnames that must never appear in a production allowlist. */
const FORBIDDEN_PROD_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  '::',
  '[::]',
]);

function isProductionEnv(nodeEnv: string | undefined): boolean {
  return (nodeEnv ?? 'development') === 'production';
}

/** Split a comma-separated list into trimmed, non-empty entries. */
function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Validate one production origin and return its canonical form
 * (`scheme://host[:port]`), or throw with a specific reason.
 */
function normalizeProductionOrigin(entry: string): string {
  if (entry === REFLECT_ANY) {
    throw new Error(
      'CORS_ORIGINS must not contain the wildcard "*" in production; list each allowed origin explicitly.',
    );
  }

  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new Error(`CORS_ORIGINS entry "${entry}" is not a valid URL.`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`CORS_ORIGINS entry "${entry}" must use https in production.`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`CORS_ORIGINS entry "${entry}" must not contain credentials.`);
  }
  if (url.search !== '') {
    throw new Error(`CORS_ORIGINS entry "${entry}" must not contain a query string.`);
  }
  if (url.hash !== '') {
    throw new Error(`CORS_ORIGINS entry "${entry}" must not contain a fragment.`);
  }
  // An origin has no path. Allow only the empty/root path; anything else means a
  // full URL was supplied where an origin was expected.
  if (url.pathname !== '' && url.pathname !== '/') {
    throw new Error(`CORS_ORIGINS entry "${entry}" must be an origin only (no path).`);
  }

  const host = url.hostname.toLowerCase();
  if (host === '' || host.includes('*') || FORBIDDEN_PROD_HOSTS.has(host)) {
    throw new Error(`CORS_ORIGINS entry "${entry}" has a disallowed host.`);
  }

  // `url.origin` is already the canonical `scheme://host[:port]` with any
  // trailing slash and path removed — exactly what Nest's exact-origin
  // matching compares against.
  return url.origin;
}

/**
 * Resolve the effective CORS origin list for the current environment.
 *
 * @param raw     the raw CORS_ORIGINS env value (comma-separated), or undefined
 * @param nodeEnv the resolved NODE_ENV
 * @returns       `['*']` to reflect any origin (dev only), otherwise an explicit
 *                allowlist of canonical origins
 * @throws        in production when the value is missing/empty/invalid
 */
export function resolveCorsOrigins(raw: string | undefined, nodeEnv: string | undefined): string[] {
  const production = isProductionEnv(nodeEnv);
  const trimmed = raw?.trim() ?? '';

  if (trimmed === '') {
    if (production) {
      throw new Error(
        'CORS_ORIGINS is required in production and must list the dashboard origin(s) explicitly (e.g. https://dashboard.example.com).',
      );
    }
    // Dev/test convenience: reflect any origin when not configured.
    return [REFLECT_ANY];
  }

  const entries = splitList(trimmed);
  if (entries.length === 0) {
    if (production) {
      throw new Error('CORS_ORIGINS is required in production but contained no valid entries.');
    }
    return [REFLECT_ANY];
  }

  if (!production) {
    // Development/test: honour the explicit list without forcing HTTPS so local
    // origins (http://localhost:3000) work. De-duplicate but keep entries as-is.
    return Array.from(new Set(entries));
  }

  const normalized = entries.map(normalizeProductionOrigin);
  return Array.from(new Set(normalized));
}
