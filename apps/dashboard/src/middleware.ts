import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Locale negotiation middleware.
 *
 * Detects the preferred locale and rewrites/redirects to the localized
 * route segment. API routes, Next.js internals and static assets are
 * excluded via the matcher below.
 */
export default createMiddleware(routing);

export const config = {
  // Match all pathnames except for:
  // - /api routes
  // - /_next internal files
  // - /_vercel internal files
  // - static assets (anything containing a dot, e.g. favicon.ico)
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
