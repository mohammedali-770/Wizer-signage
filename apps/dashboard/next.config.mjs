import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output is opt-in (the Docker build sets NEXT_OUTPUT=standalone).
  // It is left off for local `next build` because tracing/symlinking the
  // standalone bundle requires elevated privileges on Windows (EPERM on symlink).
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  reactStrictMode: true,
  transpilePackages: [
    '@master-signage/ui',
    '@master-signage/shared',
    '@master-signage/types'
  ],
  // Backward-compatible aliases: old MasterSignage marketing paths -> Wizer Signage.
  // 302 (temporary) so we can adjust later; locale-prefixed variants included.
  async redirects() {
    return [
      { source: '/mastersignage', destination: '/signage', permanent: false },
      { source: '/master-signage', destination: '/signage', permanent: false },
      { source: '/:locale/mastersignage', destination: '/:locale/signage', permanent: false },
      { source: '/:locale/master-signage', destination: '/:locale/signage', permanent: false },
    ];
  }
};

export default withNextIntl(nextConfig);
