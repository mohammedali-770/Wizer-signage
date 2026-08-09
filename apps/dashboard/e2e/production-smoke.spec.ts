import { expect, test, type Page, type Response, type Route } from '@playwright/test';

const API_ORIGIN = 'https://api.e2e.invalid';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const ADMIN_PERMISSIONS = [
  'company:read',
  'company:update',
  'company:manage',
  'location:read',
  'location:manage',
  'screen:read',
  'screen:manage',
  'screen:command',
  'content:read',
  'content:manage',
  'playlist:read',
  'playlist:manage',
  'schedule:read',
  'schedule:manage',
  'report:read',
  'alert:read',
];

const EMPTY_PAGE = {
  items: [],
  meta: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
};

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
    if (url.pathname === '/api/notifications/unread-count') {
      return json(route, { unreadCount: 0 });
    }
    if (url.pathname === '/api/notifications') {
      return json(route, { unreadCount: 0, ...EMPTY_PAGE });
    }
    return json(route, EMPTY_PAGE);
  });
  await page.addInitScript(() => window.localStorage.setItem('ms_access_token', 'e2e-access'));
}

/**
 * Mock only the API boundary; every dashboard page, form, validation path,
 * multipart upload, router transition and CSP/RTL behavior remains real.
 */
async function mockOperatorJourneyApi(page: Page) {
  await page.route(`${API_ORIGIN}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === '/api/auth/login' && method === 'POST') {
      return json(route, { accessToken: 'e2e-access', mustEnableTwoFactor: false });
    }
    if (url.pathname === '/api/auth/me' && method === 'GET') {
      return json(route, {
        user: {
          id: 'admin-e2e',
          email: 'admin@example.invalid',
          name: 'E2E Company Admin',
          role: 'COMPANY_ADMIN',
          status: 'ACTIVE',
          companyId: 'company-e2e',
        },
        permissions: ADMIN_PERMISSIONS,
        mfaSatisfied: true,
        twoFactorRequired: false,
      });
    }
    if (url.pathname === '/api/notifications/unread-count') {
      return json(route, { unreadCount: 0 });
    }
    if (url.pathname === '/api/notifications') {
      return json(route, { unreadCount: 0, ...EMPTY_PAGE });
    }

    if (url.pathname === '/api/screens' && method === 'POST') {
      return json(route, { id: 'screen-e2e' }, 201);
    }
    if (url.pathname === '/api/content/upload' && method === 'POST') {
      return json(route, { id: 'content-e2e' }, 201);
    }
    if (url.pathname === '/api/schedules' && method === 'POST') {
      return json(route, { id: 'schedule-e2e' }, 201);
    }

    // All selectors in this smoke intentionally start empty. Creation itself is
    // what is under test; optional location/tags/playlist/target selections are
    // not prerequisites and would only add fixture noise.
    if (
      method === 'GET' &&
      [
        '/api/screens',
        '/api/locations',
        '/api/tags',
        '/api/playlists',
        '/api/screen-groups',
      ].includes(url.pathname)
    ) {
      return json(route, EMPTY_PAGE);
    }

    return json(route, method === 'GET' ? EMPTY_PAGE : {});
  });
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
  return (
    csp
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('script-src ')) ?? ''
  );
}

async function expectProductionDocument(response: Response | null, page: Page, locale: 'en' | 'ar') {
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  const csp = response?.headers()['content-security-policy'] ?? '';
  const scripts = scriptDirective(csp);
  expect(scripts).toContain("'strict-dynamic'");
  expect(scripts).toMatch(/'nonce-[^']+'/);
  expect(scripts).not.toContain("'unsafe-inline'");
  expect(scripts).not.toContain("'unsafe-eval'");
}

for (const locale of ['en', 'ar'] as const) {
  test(`${locale} login hydrates under nonce CSP`, async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    const response = await page.goto(`/${locale}/login`);
    await expectProductionDocument(response, page, locale);

    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button')).toBeVisible();

    const frameworkNonces = await page.locator('script[src*="/_next/"]').evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).nonce).filter(Boolean),
    );
    expect(frameworkNonces.length).toBeGreaterThan(0);
    expect(new Set(frameworkNonces).size).toBe(1);

    await page.waitForLoadState('networkidle');
    expect(runtimeErrors).toEqual([]);
  });

  test(`${locale} production journey: login → screens → create screen → upload → schedule`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtimeErrors = collectRuntimeErrors(page);
    await mockOperatorJourneyApi(page);

    // 1. Real login form + AuthProvider session establishment.
    const loginDocument = await page.goto(`/${locale}/login`);
    await expectProductionDocument(loginDocument, page, locale);
    await page.locator('input[type="email"]').fill('admin@example.invalid');
    await page.locator('input[type="password"]').fill('correct-horse-battery-staple');
    const loginResponse = page.waitForResponse(
      (response) =>
        response.url() === `${API_ORIGIN}/api/auth/login` && response.request().method() === 'POST',
    );
    await page.locator('form button[type="submit"]').click();
    expect((await loginResponse).ok()).toBeTruthy();
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('ms_access_token')))
      .toBe('e2e-access');

    // 2. Screens index renders under the production shell and locale direction.
    const screensDocument = await page.goto(`/${locale}/company/screens`);
    await expectProductionDocument(screensDocument, page, locale);
    await expect(page.locator('main')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByText('E2E Company Admin')).toBeVisible();

    // 3. Create a screen through the real form and assert the API payload.
    const newScreenDocument = await page.goto(`/${locale}/company/screens/new`);
    await expectProductionDocument(newScreenDocument, page, locale);
    const screenName = `Smoke Screen ${locale}`;
    await page.locator('form input[required]').first().fill(screenName);
    const screenCreated = page.waitForResponse(
      (response) =>
        response.url() === `${API_ORIGIN}/api/screens` && response.request().method() === 'POST',
    );
    await page.locator('form button[type="submit"]').click();
    const screenResponse = await screenCreated;
    expect(screenResponse.status()).toBe(201);
    expect(screenResponse.request().postDataJSON()).toEqual(
      expect.objectContaining({ name: screenName, orientation: 'LANDSCAPE' }),
    );

    // 4. Upload a real in-memory file through the multipart content form.
    const contentDocument = await page.goto(`/${locale}/company/content/new`);
    await expectProductionDocument(contentDocument, page, locale);
    const fileName = `smoke-upload-${locale}.png`;
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await expect(page.locator('input[required]').first()).toHaveValue(`smoke-upload-${locale}`);
    const contentCreated = page.waitForResponse(
      (response) =>
        response.url() === `${API_ORIGIN}/api/content/upload` &&
        response.request().method() === 'POST',
    );
    await page.locator('form button[type="submit"]').click();
    const uploadResponse = await contentCreated;
    expect(uploadResponse.status()).toBe(201);
    expect(uploadResponse.request().headers()['content-type']).toContain('multipart/form-data');

    // 5. Create a schedule through the real schedule UI.
    const scheduleDocument = await page.goto(`/${locale}/company/schedules/new`);
    await expectProductionDocument(scheduleDocument, page, locale);
    const scheduleName = `Smoke Schedule ${locale}`;
    await page.locator('main input').first().fill(scheduleName);
    await page.locator('input[type="date"]').first().fill('2026-08-10');
    const scheduleCreated = page.waitForResponse(
      (response) =>
        response.url() === `${API_ORIGIN}/api/schedules` && response.request().method() === 'POST',
    );
    await page.locator('main button').last().click();
    const scheduleResponse = await scheduleCreated;
    expect(scheduleResponse.status()).toBe(201);
    expect(scheduleResponse.request().postDataJSON()).toEqual(
      expect.objectContaining({ name: scheduleName, status: 'ACTIVE', scheduleType: 'NORMAL' }),
    );

    // CSP/runtime errors would make this flow unreliable in production even if
    // each API request itself succeeded.
    await page.waitForTimeout(50);
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
