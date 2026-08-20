import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const dockerfile = readFileSync(resolve(root, 'infra/docker/Dockerfile.maintenance'), 'utf8');
const crontab = readFileSync(resolve(root, 'infra/docker/crontab'), 'utf8');
const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
const canary = readFileSync(resolve(root, 'scripts/log-shipping-canary.sh'), 'utf8');
const observability = readFileSync(resolve(root, 'docs/observability.md'), 'utf8');

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
    expect(dockerfile).toMatch(/apk add[^\n]*\bpostgresql\d+-client\b/);
    expect(crontab).toContain('backup-db.sh');
    expect(crontab).toContain('ensure-telemetry-partitions.sh');
  });

  // pg_dump 17+ writes `SET transaction_timeout = 0;` into the dump preamble,
  // which PostgreSQL 16 rejects -- and restore-db.sh pipes dumps into
  // `psql --set ON_ERROR_STOP=on`, so the restore aborts before any row is
  // applied. The unversioned `postgresql-client` package is virtual and floats
  // to whatever major Alpine ships newest, so the pin has to be explicit and it
  // has to track the server. CI's Postgres service is the authority here: it is
  // the major every backup/restore drill actually runs against.
  it('pins the PostgreSQL client to the same major the drills run against', () => {
    const client = dockerfile.match(/apk add[^\n]*\bpostgresql(\d+)-client\b/);
    expect(client).not.toBeNull();

    const serverMajors = [...ci.matchAll(/image:\s*postgres:(\d+)-alpine/g)].map((m) => m[1]);
    expect(serverMajors.length).toBeGreaterThan(0);
    expect(new Set(serverMajors).size).toBe(1);

    expect(client?.[1]).toBe(serverMajors[0]);
  });

  // This container runs the nightly backup, so it runs BACKUP_OFFSITE_CMD. It
  // previously shipped nothing that could copy a file off the host -- no rclone,
  // aws, curl, scp, ssh or rsync -- which made both commands documented in
  // docs/backup-restore.md exit 127 here and left busybox `wget --post-file`,
  // which truncates a gzip dump at its first NUL byte and still exits 0.
  it('ships a transfer tool capable of performing the offsite backup copy', () => {
    expect(dockerfile).toMatch(/apk add[^\n]*\brclone\b/);
    expect(crontab).toContain('backup-db.sh');
  });

  // fluentd-async makes a dead collector completely silent -- containers stay
  // healthy, docker logs looks normal, the daemon logs nothing, and no line
  // leaves the host. The canary is the only thing that makes that visible, and
  // it only works if the marker the script emits is the marker the operator's
  // collector rule matches. Those two live in different places, so pin them.
  it('emits a log-shipping canary whose marker matches the documented rule', () => {
    expect(crontab).toContain('log-shipping-canary.sh');
    expect(crontab).toMatch(/\*\/\d+ \* \* \* \*[^\n]*log-shipping-canary\.sh/);

    const marker = canary.match(/LOG_CANARY_MARKER='([^']+)'/);
    expect(marker).not.toBeNull();
    expect(canary).toContain(`"marker":"%s"`);

    // The operator configures their collector against the marker printed in the
    // runbook. If the script's value drifts from it the alert stops firing and
    // nothing else in the system would notice.
    expect(observability).toContain(marker?.[1]);
  });

  it('keeps the fast OTA reconciliation and daily partition-preparation jobs', () => {
    expect(crontab).toContain('android-ota-health');
    expect(crontab).toContain('wizer-ota-health.lock');
    expect(crontab).toContain('wizer-partitions.lock');
    expect(crontab).toContain('ensure-telemetry-partitions.sh');
  });
});
