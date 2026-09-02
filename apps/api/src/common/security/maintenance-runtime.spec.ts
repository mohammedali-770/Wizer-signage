import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const dockerfile = readFileSync(resolve(root, 'infra/docker/Dockerfile.maintenance'), 'utf8');
const crontab = readFileSync(resolve(root, 'infra/docker/crontab'), 'utf8');
// Every file that stands up a PostgreSQL server the backup/restore path is
// exercised against. The client pin has to equal the major in all of them.
const pgServerSources = [
  '.github/workflows/ci.yml',
  '.github/workflows/nightly.yml',
  'scripts/tests/backup-restore-drill.sh',
  'scripts/tests/telemetry-backup-restore-drill.sh',
  'scripts/tests/backup-maintenance-e2e.sh',
].map((path) => ({ path, text: readFileSync(resolve(root, path), 'utf8') }));
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

  // The client major has to track the server major in BOTH directions, and the
  // unversioned `postgresql-client` package is virtual -- it floats to whatever
  // major Alpine ships newest -- so the pin has to be explicit:
  //
  //   too new: pg_dump 17+ writes `SET transaction_timeout = 0;` into the dump
  //            preamble, which a 16 server rejects, and restore-db.sh pipes
  //            dumps into `psql --set ON_ERROR_STOP=on`, so the restore aborts
  //            before any row is applied -- a backup that is silently
  //            unrestorable;
  //   too old: pg_dump REFUSES to dump a newer server outright, so there is no
  //            backup at all. The image shipped postgresql16-client against the
  //            17.6 production server until 2026-09-02 and the nightly backup
  //            failed every night for it.
  //
  // The Postgres servers this repo stands up are the authority: they are what
  // the backup and restore drills actually run against. Earlier this read only
  // CI's `image:` lines, which left CI's own `docker run postgres:N-alpine` and
  // all three drill scripts free to drift -- and a drill that restores into a
  // different major from the one the client targets proves nothing.
  it('pins the PostgreSQL client to the same major every drill runs against', () => {
    const client = dockerfile.match(/apk add[^\n]*\bpostgresql(\d+)-client\b/);
    expect(client).not.toBeNull();

    const byFile = pgServerSources.map(({ path, text }) => ({
      path,
      majors: [...new Set([...text.matchAll(/postgres:(\d+)-alpine/g)].map((m) => m[1]))],
    }));

    // Every listed file must actually pin one, or the assertion silently covers
    // less than it claims the day a path is renamed.
    expect(byFile.filter(({ majors }) => majors.length === 0)).toEqual([]);

    const disagreeing = byFile.filter(
      ({ majors }) => majors.length > 1 || majors[0] !== client?.[1],
    );
    expect({ client: client?.[1], disagreeing }).toEqual({ client: client?.[1], disagreeing: [] });
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

    // RUN the script rather than reading it. What matters is the string that
    // actually reaches the collector, and a source-only assertion would stay
    // green while the emitted marker drifted -- which is exactly the failure
    // mode this canary exists to rule out everywhere else.
    const emitted = execFileSync('bash', [resolve(root, 'scripts/log-shipping-canary.sh')], {
      encoding: 'utf8',
      env: { ...process.env, IMAGE_TAG: 'spec-release' },
    });
    const parsed = JSON.parse(emitted);

    expect(parsed.logger).toBe('log-shipping-canary');
    expect(parsed.release).toBe('spec-release');
    expect(typeof parsed.marker).toBe('string');
    expect(parsed.marker.length).toBeGreaterThan(0);

    // The operator configures their collector rule against the marker printed in
    // the runbook. If the emitted value drifts from it the alert stops firing and
    // nothing else in the system would notice.
    expect(observability).toContain(parsed.marker);
  });

  // A canary that emits malformed JSON breaks the collector rule in the one way
  // nothing downstream would report. IMAGE_TAG comes from the deploy environment.
  it('emits well-formed JSON even for hostile release tags', () => {
    for (const tag of ['v1.2.3', 'a"b\\c', 'tag\nwith\nnewlines', '$(id)', '%s%n']) {
      const emitted = execFileSync('bash', [resolve(root, 'scripts/log-shipping-canary.sh')], {
        encoding: 'utf8',
        env: { ...process.env, IMAGE_TAG: tag },
      });
      const parsed = JSON.parse(emitted);
      expect(parsed.marker).toBe('wizer.log-shipping.canary');
      expect(parsed.release).not.toContain('"');
      expect(parsed.release).not.toContain('\n');
    }
  });

  it('keeps the fast OTA reconciliation and daily partition-preparation jobs', () => {
    expect(crontab).toContain('android-ota-health');
    expect(crontab).toContain('wizer-ota-health.lock');
    expect(crontab).toContain('wizer-partitions.lock');
    expect(crontab).toContain('ensure-telemetry-partitions.sh');
  });
});
