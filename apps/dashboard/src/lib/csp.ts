const SAFE_FALLBACK_API_ORIGIN = 'self';

function apiOrigin(raw: string | undefined): string {
  if (!raw) return SAFE_FALLBACK_API_ORIGIN;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return SAFE_FALLBACK_API_ORIGIN;
    return url.origin;
  } catch {
    return SAFE_FALLBACK_API_ORIGIN;
  }
}

/**
 * Strict page-level CSP for the dashboard.
 *
 * JavaScript is nonce-only in production; there is deliberately no
 * `unsafe-inline` escape hatch in script-src. Styles remain `unsafe-inline`
 * because Next/React and next-themes still emit legitimate inline style
 * attributes that do not inherit a script nonce. External tenant content is
 * rendered in a sandboxed iframe, so frame-src permits HTTPS without relaxing
 * script execution in the dashboard document itself.
 */
export function buildContentSecurityPolicy(options: {
  nonce: string;
  apiUrl?: string;
  development?: boolean;
}): string {
  const { nonce, development = false } = options;
  const connect = apiOrigin(options.apiUrl);

  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `media-src 'self' blob: https:`,
    `connect-src 'self'${connect === SAFE_FALLBACK_API_ORIGIN ? '' : ` ${connect}`}`,
    `frame-src https:`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'self'`,
    ...(development ? [] : ['upgrade-insecure-requests']),
  ];

  return directives.join('; ');
}
