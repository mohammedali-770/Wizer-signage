import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/common/crypto/password.service';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'Correct-Horse9!';
const SUFFIX = 'refresh-cookie-e2e';
const DASHBOARD_ORIGIN = process.env.APP_URL ?? process.env.DASHBOARD_URL ?? 'http://localhost:3000';

function setCookieHeader(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw new Error('Expected Set-Cookie response header');
  return value;
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';', 1)[0] as string;
}

describe('browser refresh cookie (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);
    const company = await prisma.company.create({
      data: { name: `Test ${SUFFIX}`, slug: `test-${SUFFIX}` },
    });
    email = `owner@${SUFFIX}.invalid`;
    await prisma.user.create({
      data: {
        companyId: company.id,
        email,
        name: 'Cookie Owner',
        passwordHash: await passwords.hash(PASSWORD),
        role: UserRole.COMPANY_ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { endsWith: `@${SUFFIX}.invalid` } } });
      await prisma.company.deleteMany({ where: { slug: `test-${SUFFIX}` } });
    }
    await app?.close();
  });

  it('keeps the refresh credential out of JSON and puts it in a scoped HttpOnly cookie', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', DASHBOARD_ORIGIN)
      .send({ email, password: PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.accessToken).toEqual(expect.any(String));
    expect(login.body).not.toHaveProperty('refreshToken');

    const cookie = setCookieHeader(login);
    expect(cookie).toMatch(/^wizer_refresh=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/refresh/i);
    // NODE_ENV=test in CI, so Secure is deliberately not asserted here. The
    // production branch in AuthController sets it; using Secure in this HTTP
    // e2e harness would prevent supertest from sending the cookie at all.
  });

  it('rotates from the cookie, not from a JavaScript-readable request body', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD });
    const firstSetCookie = setCookieHeader(login);

    const refreshed = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Origin', DASHBOARD_ORIGIN)
      .set('Cookie', cookiePair(firstSetCookie))
      .send({});

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    expect(refreshed.body).not.toHaveProperty('refreshToken');
    const secondSetCookie = setCookieHeader(refreshed);
    expect(cookiePair(secondSetCookie)).not.toEqual(cookiePair(firstSetCookie));
  });

  it('rejects refresh with no cookie even if an old-style token-shaped body is sent', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Origin', DASHBOARD_ORIGIN)
      .send({ refreshToken: 'legacy-token-must-not-be-used' });

    // Global validation may reject the obsolete property (400) before the
    // controller, or the controller rejects the missing cookie (401). Either is
    // safe; a body token must never authenticate the request.
    expect([400, 401]).toContain(res.status);
  });

  it('rejects a browser cross-site refresh before rotating the session', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD });
    const cookie = cookiePair(setCookieHeader(login));

    const wrongOrigin = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Origin', 'https://attacker.invalid')
      .set('Cookie', cookie)
      .send({});
    expect(wrongOrigin.status).toBe(403);

    const crossSite = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Cookie', cookie)
      .send({});
    expect(crossSite.status).toBe(403);
  });
});
