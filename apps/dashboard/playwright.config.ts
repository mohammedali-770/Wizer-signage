import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm build && pnpm start -- -p 3100',
    url: 'http://127.0.0.1:3100/en/login',
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_URL: 'https://api.e2e.invalid/api',
      NODE_ENV: 'production',
    },
  },
});
