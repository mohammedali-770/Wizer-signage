import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const preflightPath = resolve(root, 'scripts/production-preflight.sh');
const preflight = readFileSync(preflightPath, 'utf8');

describe('production preflight contract', () => {
  it('is syntactically valid bash', () => {
    expect(() => execFileSync('bash', ['-n', preflightPath])).not.toThrow();
  });

  it('is read-only and validates blue-green plus logging compose graphs', () => {
    expect(preflight).toContain('config --quiet');
    expect(preflight).toContain('docker-compose.blue-green-proxy.yml');
    expect(preflight).toContain('docker-compose.blue-green-slots.yml');
    expect(preflight).toContain('docker-compose.log-shipping.yml');
    expect(preflight).toContain('docker-compose.blue-green-log-shipping.yml');
    expect(preflight).not.toMatch(/docker compose[\s\S]{0,80}\b(up|down|restart|stop|rm)\b/);
    expect(preflight).not.toContain('prisma migrate');
  });

  it('requires production registry, database, auth, metrics, recovery, logging, mail and storage coordinates', () => {
    for (const key of [
      'APP_DOMAIN',
      'DATABASE_URL',
      'DIRECT_URL',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'ENCRYPTION_KEY',
      'IMAGE_REGISTRY_PREFIX',
      'METRICS_TOKEN',
      'BACKUP_OFFSITE_CMD',
      'HEALTHCHECKS_URL',
      'LOG_SHIPPING_ADDRESS',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_FROM',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_STORAGE_BUCKET',
    ]) {
      expect(preflight).toContain(key);
    }
  });

  it('validates the same APP_URL then DASHBOARD_URL precedence used for email links', () => {
    expect(preflight).toContain('PUBLIC_DASHBOARD_URL="$(read_env_value APP_URL)"');
    expect(preflight).toContain('PUBLIC_DASHBOARD_URL="$(read_env_value DASHBOARD_URL)"');
    expect(preflight).toContain('APP_URL or DASHBOARD_URL is required for production email links');
    expect(preflight).toContain('public HTTPS origin without credentials, path, query or fragment');
    expect(preflight).toContain('public dashboard email-link origin is configured');
  });

  it('rejects common placeholder/local configuration and weak secrets', () => {
    expect(preflight).toContain('placeholder/development value');
    expect(preflight).toContain('METRICS_TOKEN must be at least 32 characters');
    expect(preflight).toContain('APP_DOMAIN points at a local/development hostname');
    expect(preflight).toContain('points at localhost');
  });

  it('requires persistent Supabase production storage', () => {
    expect(preflight).toContain('SUPABASE_URL must be an HTTPS project URL');
    expect(preflight).toContain('SUPABASE_SERVICE_ROLE_KEY is implausibly short');
    expect(preflight).toContain('SUPABASE_STORAGE_BUCKET has an invalid bucket name');
    expect(preflight).toContain('persistent Supabase production storage is configured');
  });

  it('refuses same-host-only backup posture and missing out-of-band backup monitoring', () => {
    expect(preflight).toContain('BACKUP_OFFSITE_CMD is a no-op');
    expect(preflight).toContain('configure a real off-host copy command');
    expect(preflight).toContain('HEALTHCHECKS_URL must be an HTTPS dead-man monitoring URL');
    expect(preflight).toContain('out-of-band backup dead-man monitoring is configured');
  });

  it('requires a production off-box log collector and validates its port', () => {
    expect(preflight).toContain('LOG_SHIPPING_ADDRESS must be a collector host:port');
    expect(preflight).toContain('LOG_SHIPPING_ADDRESS port must be 1-65535');
    expect(preflight).toContain('off-box logging collector coordinate is configured');
  });

  it('requires live SMTP delivery before deployment', () => {
    expect(preflight).toContain('SMTP_HOST points at a placeholder/local mail server');
    expect(preflight).toContain('SMTP_PORT must be 1-65535');
    expect(preflight).toContain('SMTP_FROM must contain a sender email address');
    expect(preflight).toContain('neither SMTP_PASSWORD nor SMTP_PASS is set');
    expect(preflight).toContain('live SMTP delivery coordinates are configured');
  });

  it('checks host headroom before a release begins', () => {
    expect(preflight).toContain('MIN_FREE_GB');
    expect(preflight).toContain('MIN_NOFILE');
    expect(preflight).toContain('free disk');
    expect(preflight).toContain('open-file limit');
  });

  it('accepts only a full immutable Git SHA when a target is supplied', () => {
    expect(preflight).toContain('40-character lowercase Git SHA');
    expect(preflight).toContain('^[0-9a-f]{40}$');
  });
});
