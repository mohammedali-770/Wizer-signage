# Dashboard nonce Content Security Policy

The dashboard uses a fresh CSP nonce for every rendered page request. Middleware composes locale routing with the security policy: it places the nonce-bearing `Content-Security-Policy` on the request before Next.js renders, and returns the same policy to the browser.

Production `script-src` is nonce-backed with `strict-dynamic` and has no `unsafe-inline` or `unsafe-eval` JavaScript fallback. Because the nonce is request-specific, localized HTML is rendered dynamically rather than statically prerendered; serving a cached HTML shell would pair scripts with the wrong or missing nonce.

When changing middleware, locale routing, script loading, or rendering mode, run the CSP policy tests and the Playwright EN/AR hydration smoke. Do not solve a compatibility regression by adding `unsafe-inline` to `script-src`.