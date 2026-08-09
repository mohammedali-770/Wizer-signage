import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const dockerfile = readFileSync(resolve(root, 'infra/docker/Dockerfile.maintenance'), 'utf8');
const crontab = readFileSync(resolve(root, 'infra/docker/crontab'), 'utf8');

describe('maintenance runtime image / cron contract', () => {
  it('ships every repository shell script invoked by cron', () => {
    const scripts = [...crontab.matchAll(/(?:bash\s+)?(scripts\/[A-Za-z0-9._/-]+\.sh)/g)].map(
      (match) => match[1],
    );
    expect(scripts.length).toBeGreaterThanOrEqual(3);

    for (const script of new Set(scripts)) {
      expect(dockerfile).toContain(`COPY --chown=node:node ${script} ./${script}`);
      expect(dockerfile).toContain(`./${script}`);
    }
  });

  it('installs PostgreSQL client tools required by backup and partition jobs', () => {
    expect(dockerfile).toContain('postgresql-client');
    expect(crontab).toContain('backup-db.sh');
    expect(crontab).toContain('ensure-telemetry-partitions.sh');
  });

  it('keeps the fast OTA reconciliation and daily partition-preparation jobs', () => {
    expect(crontab).toContain('android-ota-health');
    expect(crontab).toContain('wizer-ota-health.lock');
    expect(crontab).toContain('wizer-partitions.lock');
    expect(crontab).toContain('ensure-telemetry-partitions.sh');
  });
});
