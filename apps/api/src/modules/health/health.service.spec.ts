import { HealthService } from './health.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build(over: { dbOk?: boolean; supabase?: any; smtp?: any } = {}) {
  const prisma: any = {
    $queryRaw: jest.fn(() =>
      over.dbOk === false
        ? Promise.reject(new Error('down'))
        : Promise.resolve([{ '?column?': 1 }]),
    ),
  };
  const config: any = {
    get: (key: string) =>
      key === 'supabase' ? (over.supabase ?? {}) : key === 'smtp' ? (over.smtp ?? {}) : undefined,
  };
  return new HealthService(prisma, config);
}

describe('HealthService', () => {
  describe('check (liveness)', () => {
    it('reports status "ok" with the canonical service name + numeric uptime', () => {
      const result = build().check();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('master-signage-api');
      expect(typeof result.uptime).toBe('number');
      expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
    });
  });

  describe('ready (readiness)', () => {
    // storageConfigured falls back to process.env.STORAGE_LOCAL_DIR, which the
    // injected config can't override. Clear it so these tests are hermetic and
    // depend only on the mocked supabase/smtp config (a local .env that sets
    // STORAGE_LOCAL_DIR must not flip the assertions).
    const originalStorageDir = process.env.STORAGE_LOCAL_DIR;
    beforeEach(() => {
      delete process.env.STORAGE_LOCAL_DIR;
    });
    afterEach(() => {
      if (originalStorageDir === undefined) delete process.env.STORAGE_LOCAL_DIR;
      else process.env.STORAGE_LOCAL_DIR = originalStorageDir;
    });

    it('reports ok + database up when the DB query succeeds', async () => {
      const r = await build({
        dbOk: true,
        supabase: { url: 'u', serviceRoleKey: 'k' },
        smtp: { host: 'h', port: 587 },
      }).ready();
      expect(r.status).toBe('ok');
      expect(r.checks.database).toBe('up');
      expect(r.checks.storageConfigured).toBe(true);
      expect(r.checks.mailConfigured).toBe(true);
    });

    it('reports degraded + database down when the DB query fails', async () => {
      const r = await build({ dbOk: false }).ready();
      expect(r.status).toBe('degraded');
      expect(r.checks.database).toBe('down');
    });

    it('never leaks secrets — only booleans/flags', async () => {
      const r = await build({ dbOk: true, supabase: {}, smtp: {} }).ready();
      expect(r.checks.storageConfigured).toBe(false);
      expect(r.checks.mailConfigured).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/serviceRoleKey|password|secret/i);
    });
  });
});
