import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import { authenticator } from 'otplib';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/common/crypto/password.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Re-authentication on the 2FA management routes, driven over real HTTP.
 *
 * The unit suite covers `TwoFactorService.reauthenticate` thoroughly, with the
 * password service and Prisma mocked. What it cannot show is that the rule
 * survives the trip through the controller, the validation pipe and the guards
 * — the layers between a request and that method. A DTO that forgot to require
 * `password`, or a controller that dropped the field on its way to the service,
 * leaves every unit test green and the hole wide open.
 *
 * So this asserts the observable behaviour: a caller holding a VALID session
 * token still cannot enrol an authenticator without the account password. That
 * is the exact scenario the fix exists for — a stolen token.
 *
 * Needs DATABASE_URL and a migrated schema (CI's `quality` job provides both).
 */

const PASSWORD = 'Correct-Horse9!';
const WRONG = 'Wrong-Horse9!';
const SUFFIX = 'twofactor-reauth-e2e';

describe('2FA re-authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let userId: string;

  const post = (path: string, body: object) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    // Mirrors main.ts, so a body rejected here is rejected in production too.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);

    // A throwaway tenant + user. Cleaned up in afterAll, and namespaced so a
    // failed run cannot collide with the next one.
    const company = await prisma.company.create({
      data: { name: `Test ${SUFFIX}`, slug: `test-${SUFFIX}` },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        email: `owner@${SUFFIX}.invalid`,
        name: 'Test Owner',
        passwordHash: await passwords.hash(PASSWORD),
        role: UserRole.COMPANY_ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(200);
    accessToken = login.body.accessToken as string;
    expect(accessToken).toEqual(expect.any(String));
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { endsWith: `@${SUFFIX}.invalid` } } });
      await prisma.company.deleteMany({ where: { slug: `test-${SUFFIX}` } });
    }
    await app?.close();
  });

  it('holds a valid session token — the precondition for everything below', async () => {
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
  });

  /**
   * ONE flow, in order, sharing a call budget.
   *
   * These routes are throttled at 5/minute (added with the re-auth fix, because
   * every one of them now runs an Argon2 verification and is therefore a
   * password oracle for anyone holding a token). Splitting the flow into a test
   * per assertion spent that budget and the later ones came back 429 — so the
   * sequence lives in one test, and the throttle gets an assertion of its own
   * at the end rather than being worked around.
   *
   * Re-enrolment over EXISTING 2FA needs calls this budget cannot afford; it is
   * covered by the unit suite, which watches it fail under mutation.
   */
  it('will not enrol an authenticator on a valid session without the password', async () => {
    // 1. No password at all — the DTO gate. This body used to be accepted.
    const missing = await post('/api/auth/2fa/setup', {});
    expect(missing.status).toBe(400);

    // 2. Wrong password: rejected, no secret disclosed, nothing written.
    const wrong = await post('/api/auth/2fa/setup', { password: WRONG });
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.body)).not.toMatch(/secret|otpauth/i);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).twoFactorPendingSecret,
    ).toBeNull();

    // 3. Correct password: enrolment begins.
    const setup = await post('/api/auth/2fa/setup', { password: PASSWORD });
    expect(setup.status).toBe(201);
    const secret = setup.body.secret as string;
    expect(secret).toEqual(expect.any(String));

    // 4. A VALID code is not enough to enable — the password is required too.
    const noPassword = await post('/api/auth/2fa/enable', {
      code: authenticator.generate(secret),
      password: WRONG,
    });
    expect(noPassword.status).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).twoFactorEnabled).toBe(
      false,
    );

    // 5. Both together: enabled, and the backup codes are issued once.
    const enabled = await post('/api/auth/2fa/enable', {
      code: authenticator.generate(secret),
      password: PASSWORD,
    });
    expect(enabled.status).toBe(200);
    expect(enabled.body.backupCodes).toHaveLength(10);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).twoFactorEnabled).toBe(
      true,
    );
  }, 30_000);

  it('once 2FA is on, the password alone no longer opens re-enrolment', async () => {
    // The account now HAS a second factor, so the password is one factor of
    // two. Accepting it alone here would let a leaked password replace the
    // authenticator and destroy the backup codes in the same transaction —
    // defeating the very thing the second factor exists for.
    //
    // Reached with the last call this test's throttle budget allows (these
    // routes are capped at 5/minute since the re-auth fix, because each one now
    // runs an Argon2 verification). Supplying a valid `currentCode` alongside
    // the password is the accepting path; it is covered by the unit suite,
    // which watches it fail under mutation.
    const res = await post('/api/auth/2fa/setup', { password: PASSWORD });
    expect(res.status).toBe(401);

    // Still enabled, and the enrolment was not restarted behind the refusal.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.twoFactorEnabled).toBe(true);
    expect(row.twoFactorPendingSecret).toBeNull();
  });
});
