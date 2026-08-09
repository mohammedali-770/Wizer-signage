import { validate } from './env.validation';

/**
 * Environment validation — the boot-time gate. These tests pin the fail-closed
 * production requirements: a misconfigured production environment must stop the
 * process before it serves traffic, rather than degrading silently.
 */
describe('validate (environment)', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@db.example:5432/app',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    ENCRYPTION_KEY: 'c'.repeat(32),
  };

  const dashboard = {
    DASHBOARD_URL: 'https://signage.wizer.sa',
  };

  const smtp = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_FROM: 'Wizer Signage <no-reply@example.com>',
  };

  const storage = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-production-tests',
    SUPABASE_STORAGE_BUCKET: 'wizer-signage',
  };

  const production = { ...base, ...dashboard, ...smtp, ...storage, NODE_ENV: 'production' };

  describe('required secrets', () => {
    it('accepts a complete development environment without production-only services', () => {
      expect(() => validate({ ...base, NODE_ENV: 'development' })).not.toThrow();
    });

    it('rejects a missing DATABASE_URL', () => {
      const { DATABASE_URL, ...withoutDb } = base;
      expect(() => validate({ ...withoutDb, NODE_ENV: 'development' })).toThrow(/DATABASE_URL/);
    });

    it('rejects a too-short JWT secret', () => {
      expect(() => validate({ ...base, JWT_ACCESS_SECRET: 'short', NODE_ENV: 'development' })).toThrow(
        /JWT_ACCESS_SECRET/,
      );
    });
  });

  describe('JWT lifetimes', () => {
    const ttl = (v: Record<string, string>) => () => validate({ ...base, NODE_ENV: 'development', ...v });

    it('accepts durations carrying an explicit unit', () => {
      for (const v of ['15m', '30d', '900s', '2h', '1w', '250ms', '1.5h', '2 hours']) {
        expect(ttl({ JWT_ACCESS_TTL: v })).not.toThrow();
      }
    });

    it('rejects a bare number, which would be read as milliseconds', () => {
      expect(ttl({ JWT_ACCESS_TTL: '900' })).toThrow(/JWT_ACCESS_TTL/);
      expect(ttl({ JWT_REFRESH_TTL: '2592000' })).toThrow(/JWT_REFRESH_TTL/);
    });

    it('rejects typos and junk that previously passed as plain strings', () => {
      for (const v of ['15mn', 'fifteen minutes', '', 'm15', '15m30s', 'banana']) {
        expect(ttl({ JWT_ACCESS_TTL: v })).toThrow(/JWT_ACCESS_TTL/);
      }
    });

    it('explains the unit requirement rather than just naming the variable', () => {
      expect(ttl({ JWT_ACCESS_TTL: '900' })).toThrow(/explicit unit/);
    });
  });

  describe('production dashboard origin requirement', () => {
    it('rejects production without APP_URL or DASHBOARD_URL', () => {
      expect(() => validate({ ...base, ...smtp, ...storage, NODE_ENV: 'production' })).toThrow(
        /APP_URL or DASHBOARD_URL is required/,
      );
    });

    it('rejects HTTP, localhost, credentials, paths, queries and fragments', () => {
      for (const url of [
        'http://signage.wizer.sa',
        'https://localhost:3000',
        'https://127.0.0.1',
        'https://user:pass@signage.wizer.sa',
        'https://signage.wizer.sa/app',
        'https://signage.wizer.sa?debug=1',
        'https://signage.wizer.sa#fragment',
      ]) {
        expect(() =>
          validate({ ...base, ...smtp, ...storage, NODE_ENV: 'production', DASHBOARD_URL: url }),
        ).toThrow(/public HTTPS origin/);
      }
    });

    it('accepts either alias when it is a clean public HTTPS origin', () => {
      expect(() => validate(production)).not.toThrow();
      expect(() =>
        validate({ ...base, ...smtp, ...storage, NODE_ENV: 'production', APP_URL: 'https://signage.wizer.sa' }),
      ).not.toThrow();
    });

    it('validates APP_URL when both aliases exist because APP_URL wins configuration resolution', () => {
      expect(() =>
        validate({
          ...production,
          APP_URL: 'http://localhost:3000',
          DASHBOARD_URL: 'https://signage.wizer.sa',
        }),
      ).toThrow(/public HTTPS origin/);
    });
  });

  describe('production SMTP requirement', () => {
    it('rejects production when SMTP is entirely absent', () => {
      expect(() => validate({ ...base, ...dashboard, ...storage, NODE_ENV: 'production' })).toThrow(
        /SMTP_HOST.*required when NODE_ENV=production/s,
      );
    });

    it('names every missing SMTP variable', () => {
      const input = { ...base, ...dashboard, ...storage, NODE_ENV: 'production' };
      expect(() => validate(input)).toThrow(/SMTP_HOST/);
      expect(() => validate(input)).toThrow(/SMTP_PORT/);
      expect(() => validate(input)).toThrow(/SMTP_FROM/);
    });

    it('rejects production when only some SMTP vars are set', () => {
      expect(() =>
        validate({
          ...base,
          ...dashboard,
          ...storage,
          NODE_ENV: 'production',
          SMTP_HOST: 'smtp.example.com',
        }),
      ).toThrow(/SMTP_PORT|SMTP_FROM/);
    });

    it('rejects blank/whitespace SMTP values', () => {
      expect(() => validate({ ...production, SMTP_FROM: '   ' })).toThrow(/SMTP_FROM/);
    });

    it('accepts production with complete SMTP, dashboard and persistent storage configuration', () => {
      expect(() => validate(production)).not.toThrow();
    });

    it('does not require SMTP outside production', () => {
      expect(() => validate({ ...base, NODE_ENV: 'test' })).not.toThrow();
      expect(() => validate({ ...base, NODE_ENV: 'development' })).not.toThrow();
    });
  });

  describe('production persistent storage requirement', () => {
    it('rejects production when Supabase storage is absent', () => {
      const input = { ...base, ...dashboard, ...smtp, NODE_ENV: 'production' };
      expect(() => validate(input)).toThrow(/SUPABASE_URL/);
      expect(() => validate(input)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
      expect(() => validate(input)).toThrow(/SUPABASE_STORAGE_BUCKET/);
    });

    it('rejects partial Supabase storage configuration', () => {
      expect(() =>
        validate({
          ...base,
          ...dashboard,
          ...smtp,
          NODE_ENV: 'production',
          SUPABASE_URL: storage.SUPABASE_URL,
        }),
      ).toThrow(/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_STORAGE_BUCKET/);
    });

    it('keeps the local adapter available outside production', () => {
      expect(() => validate({ ...base, NODE_ENV: 'development' })).not.toThrow();
      expect(() => validate({ ...base, NODE_ENV: 'test' })).not.toThrow();
    });
  });

  it('never echoes secret values in production error messages', () => {
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
