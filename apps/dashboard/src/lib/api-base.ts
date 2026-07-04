/**
 * Single source of truth for the browser-facing API base URL.
 *
 * `NEXT_PUBLIC_API_URL` is inlined at BUILD time by Next.js, so this resolves to a
 * constant in the client bundle. When the var is unset we choose the fallback by
 * environment so a misconfigured build can never point browsers at the wrong host:
 *   - production build  → the real production API (`https://wizer.sa/api`), never localhost;
 *   - development       → the local API (`http://localhost:3001/api`).
 *
 * In every normal deploy the build arg IS set (see apps/dashboard/Dockerfile +
 * infra/docker/docker-compose.yml), so the fallback is only a safety net. Import
 * `API_BASE_URL` everywhere instead of re-reading `process.env.NEXT_PUBLIC_API_URL`,
 * so there is exactly one place this decision lives.
 */
export const API_BASE_URL: string =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === 'production' ? 'https://wizer.sa/api' : 'http://localhost:3001/api');
