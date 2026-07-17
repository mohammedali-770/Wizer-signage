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
