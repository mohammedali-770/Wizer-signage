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

  it('is read-only and validates both blue-green compose graphs', () => {
    expect(preflight).toContain('config --quiet');
    expect(preflight).toContain('docker-compose.blue-green-proxy.yml');
    expect(preflight).toContain('docker-compose.blue-green-slots.yml');
    expect(preflight).not.toMatch(/docker compose[\s\S]{0,80}\b(up|down|restart|stop|rm)\b/);
    expect(preflight).not.toContain('prisma migrate');
  });

  it('requires production registry, database, auth and metrics coordinates', () => {
    for (const key of [
      'APP_DOMAIN',
      'DATABASE_URL',
      'DIRECT_URL',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'ENCRYPTION_KEY',
      'IMAGE_REGISTRY_PREFIX',
      'METRICS_TOKEN',
    ]) {
      expect(preflight).toContain(key);
    }
  });

  it('rejects common placeholder/local configuration and weak secrets', () => {
    expect(preflight).toContain('placeholder/development value');
    expect(preflight).toContain('METRICS_TOKEN must be at least 32 characters');
    expect(preflight).toContain('APP_DOMAIN points at a local/development hostname');
    expect(preflight).toContain('points at localhost');
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
