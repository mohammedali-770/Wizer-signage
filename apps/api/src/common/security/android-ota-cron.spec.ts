import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const crontab = readFileSync(resolve(root, 'infra/docker/crontab'), 'utf8');
const cli = readFileSync(
  resolve(root, 'apps/api/src/maintenance/maintenance.cli.ts'),
  'utf8',
);

describe('Android OTA health scheduler', () => {
  it('runs the health reconciliation every minute under a non-overlapping lock', () => {
    expect(crontab).toMatch(
      /^\* \* \* \* \* flock -n \/tmp\/wizer-ota-health\.lock .*maintenance\.cli\.js android-ota-health/m,
    );
  });

  it('keeps the frequent health command internal to the maintenance CLI', () => {
    expect(cli).toContain("command === 'android-ota-health'");
    expect(cli).toContain('app.get(AndroidOtaHealthService).sweep()');
  });
});
