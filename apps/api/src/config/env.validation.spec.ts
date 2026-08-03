import { validate } from './env.validation';

/**
 * Environment validation — the boot-time gate. These tests pin the fail-closed
 * production requirements: a misconfigured production environment must stop the
 * process before it serves traffic, rather than degrading silently.
 */
describe('validate (environment)', () => {
  // Minimum viable config: everything the validator marks REQUIRED.
  const base = {
    DATABASE_URL: 'postgresql://u:p@db.example:5432/app',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    ENCRYPTION_KEY: 'c'.repeat(32),
  };

  const smtp = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_FROM: 'Wizer Signage <no-reply@example.com>',
  };

  describe('required secrets', () => {
    it('accepts a complete development environment without SMTP', () => {
      expect(() => validate({ ...base, NODE_ENV: 'development' })).not.toThrow();
    });

    it('rejects a missing DATABASE_URL', () => {
      const { DATABASE_URL, ...withoutDb } = base;
      expect(() => validate({ ...withoutDb, NODE_ENV: 'development' })).toThrow(/DATABASE_URL/);
    });

    it('rejects a too-short JWT secret', () => {
      expect(() =>
        validate({ ...base, JWT_ACCESS_SECRET: 'short', NODE_ENV: 'development' }),
      ).toThrow(/JWT_ACCESS_SECRET/);
    });
  });

  describe('production SMTP requirement', () => {
    // In production the log-only mail fallback is dangerous: password-reset and
    // invitation emails would never arrive while the API still reported success.
    it('rejects production when SMTP is entirely absent', () => {
      expect(() => validate({ ...base, NODE_ENV: 'production' })).toThrow(
        /SMTP_HOST.*required when NODE_ENV=production/s,
      );
    });

    it('names every missing SMTP variable', () => {
      expect(() => validate({ ...base, NODE_ENV: 'production' })).toThrow(/SMTP_HOST/);
      expect(() => validate({ ...base, NODE_ENV: 'production' })).toThrow(/SMTP_PORT/);
      expect(() => validate({ ...base, NODE_ENV: 'production' })).toThrow(/SMTP_FROM/);
    });

    it('rejects production when only some SMTP vars are set', () => {
      expect(() =>
        validate({ ...base, NODE_ENV: 'production', SMTP_HOST: 'smtp.example.com' }),
      ).toThrow(/SMTP_PORT|SMTP_FROM/);
    });

    it('rejects blank/whitespace SMTP values (present but useless)', () => {
      expect(() =>
        validate({ ...base, ...smtp, NODE_ENV: 'production', SMTP_FROM: '   ' }),
      ).toThrow(/SMTP_FROM/);
    });

    it('accepts production with a complete SMTP configuration', () => {
      expect(() => validate({ ...base, ...smtp, NODE_ENV: 'production' })).not.toThrow();
    });

    it('does not require SMTP outside production', () => {
      expect(() => validate({ ...base, NODE_ENV: 'test' })).not.toThrow();
      expect(() => validate({ ...base, NODE_ENV: 'development' })).not.toThrow();
    });

    it('never echoes secret values in the error message', () => {
      const secret = 'super-secret-value-do-not-leak';
      try {
        validate({
          ...base,
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: secret,
          DATABASE_URL: secret,
        });
        fail('expected validation to throw');
      } catch (error) {
        expect((error as Error).message).not.toContain(secret);
      }
    });
  });
});
