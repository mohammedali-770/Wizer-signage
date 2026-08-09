import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';

import { buildContentSecurityPolicy } from './lib/csp';
import { routing } from './i18n/routing';

const handleI18nRouting = createMiddleware(routing);

function createNonce(): string {
  // Web Crypto + btoa are available in the Next middleware runtime. A fresh,
  // unpredictable value is generated for every page request.
  return btoa(crypto.randomUUID());
}

/**
 * Locale negotiation + strict per-request Content Security Policy.
 *
 * next-intl's middleware owns the redirect/rewrite response, so CSP request
 * headers must be attached BEFORE handing the request to it. Next.js then
 * extracts the nonce from the request CSP and automatically nonces framework
 * and page scripts during dynamic rendering. The response carries the same
 * policy for the browser to enforce.
 */
export default function middleware(request: NextRequest) {
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    development: process.env.NODE_ENV === 'development',
  });

  request.headers.set('x-nonce', nonce);
  request.headers.set('Content-Security-Policy', policy);

  const response = handleI18nRouting(request);
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  // Match all localized page requests, but not API routes, Next internals or
  // static assets. Prefetches do not render a document and do not need a nonce.
  matcher: [
    {
      source: '/((?!api|_next|_vercel|.*\\..*).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
