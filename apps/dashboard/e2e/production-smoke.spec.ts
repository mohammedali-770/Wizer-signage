import { expect, test, type Page, type Route } from '@playwright/test';

const API_ORIGIN = 'https://api.e2e.invalid';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockAuthenticatedApi(page: Page) {
  await page.route(`${API_ORIGIN}/api/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') {
      return json(route, {
        user: {
          id: 'user-e2e',
          email: 'viewer@example.invalid',
          name: 'E2E Viewer',
          role: 'VIEWER',
          status: 'ACTIVE',
          companyId: 'company-e2e',
        },
        permissions: ['screen:read', 'report:read'],
        mfaSatisfied: true,
        twoFactorRequired: false,
      });
    }
    if (url.pathname.includes('/notifications')) {
      return json(route, { unreadCount: 0, items: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    }
    return json(route, {
      items: [],
      meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
    });
  });
  await page.addInitScript(() => window.localStorage.setItem('ms_access_token', 'e2e-access'));
}

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

function scriptDirective(csp: string): string {
  return csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('script-src ')) ?? '';
}

for (const locale of ['en', 'ar'] as const) {
  test(`${locale} login hydrates under nonce CSP`, async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    const response = await page.goto(`/${locale}/login`);
    expect(response?.ok()).toBeTruthy();

    const csp = response?.headers()['content-security-policy'] ?? '';
    const scripts = scriptDirective(csp);
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).toMatch(/'nonce-[^']+'/);
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");

    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button')).toBeVisible();

    // Next.js derives framework/page script nonces from the request CSP. The DOM
    // `nonce` property is the reliable browser-facing value even when the nonce
    // attribute itself is hidden by the platform after parsing.
    const frameworkNonces = await page.locator('script[src*="/_next/"]').evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).nonce).filter(Boolean),
    );
    expect(frameworkNonces.length).toBeGreaterThan(0);
    expect(new Set(frameworkNonces).size).toBe(1);

    await page.waitForLoadState('networkidle');
    expect(runtimeErrors).toEqual([]);
  });
}

test('authenticated Arabic company shell hydrates and keeps RTL content under nonce CSP', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await mockAuthenticatedApi(page);

  const response = await page.goto('/ar/company/screens');
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/ar\/company\/screens/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('main')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('E2E Viewer')).toBeVisible();
  await expect(page.locator('nav')).toBeVisible();

  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(scriptDirective(csp)).not.toContain("'unsafe-inline'");

  await page.waitForLoadState('networkidle');
  expect(runtimeErrors).toEqual([]);
});
