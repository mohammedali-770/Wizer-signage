import { PHASE_PRODUCTION_BUILD } from 'next/constants.js';
import createNextIntlPlugin from 'next-intl/plugin';

import { validatePublicApiUrl } from './env-validation.mjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output is opt-in (the Docker build sets NEXT_OUTPUT=standalone).
  // It is left off for local `next build` because tracing/symlinking the
  // standalone bundle requires elevated privileges on Windows (EPERM on symlink).
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  reactStrictMode: true,
  experimental: {
    /**
     * Client-side Router Cache lifetimes.
     *
     * Next 15 defaults `dynamic` to 0, and the root layout calls `connection()`
     * (for the CSP nonce), which makes every route dynamic. Together those mean
     * navigating BACK to a page visited seconds ago re-fetches its whole RSC
     * payload from the droplet. The 30s client data cache (use-api.ts:25) hides
     * the API call but not that round trip.
     *
     * 30s matches that DEFAULT_TTL, so a back-navigation inside the
     * window reuses both and is instant. Deliberately not longer: these are
     * operational consoles where stale fleet state is worse than a re-fetch.
     */
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  transpilePackages: [
    '@wizer/ui',
    '@wizer/shared',
    '@wizer/types'
  ],
  // Backward-compatible aliases: old Wizer Signage marketing paths -> Wizer Signage.
  // 302 (temporary) so we can adjust later; locale-prefixed variants included.
  async redirects() {
    return [
      { source: '/mastersignage', destination: '/signage', permanent: false },
      { source: '/wizer-signage', destination: '/signage', permanent: false },
      { source: '/:locale/mastersignage', destination: '/:locale/signage', permanent: false },
      { source: '/:locale/wizer-signage', destination: '/:locale/signage', permanent: false },
    ];
  }
};

/**
 * Function-form config so we can gate build-time validation on the phase.
 *
 * A production build (`next build`) bakes NEXT_PUBLIC_API_URL into the client
 * bundle, so we validate it HERE and fail the build if it is missing or unsafe
 * (see env-validation.mjs). The dev server (`next dev`) is never a production
 * build, so local development keeps the localhost fallback in
 * src/lib/api-base.ts and is not affected.
 *
 * `next lint` also loads the config with PHASE_PRODUCTION_BUILD, so the phase
 * alone would incorrectly require the var during linting. We additionally
 * require the actual `build` sub-command (present in argv for `next build`,
 * absent for `next lint`/`next dev`) so validation runs ONLY for a real build.
 */
function isProductionBuild(phase) {
  return phase === PHASE_PRODUCTION_BUILD && process.argv.includes('build');
}

export default function config(phase) {
  if (isProductionBuild(phase)) {
    // Throws → the build aborts with a clear, non-zero exit before any client
    // bundle is emitted.
    validatePublicApiUrl(process.env.NEXT_PUBLIC_API_URL);
  }
  return withNextIntl(nextConfig);
}
