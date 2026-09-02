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

  // Regression: the parser used a greedy match on the LAST `<non-digit><digits>.
  // <digits>` in the version string. Alpine prints `pg_dump (PostgreSQL) 18.6`
  // and parsed correctly; Debian/Ubuntu append their packaging version, so
  // `pg_dump (PostgreSQL) 18.6 (Ubuntu 18.6-1.pgdg24.04+2)` matched `pgdg24.04`
  // and reported major 24. Preflight then refused to deploy on a correctly
  // configured host, comparing an imaginary host major against the image's real
  // one. Ubuntu is the ordinary host OS for this stack, so this blocked the
  // documented cutover path outright.
  //
  // This runs the expression the script actually contains rather than a copy of
  // it, so the two cannot drift apart.
  it('reads the pg_dump major from packaged and unpackaged version strings alike', () => {
    const expression = preflight.match(/host_pg_major\(\)[^|]*\|\s*sed -nE '([^']+)'/)?.[1];
    expect(expression).toBeDefined();

    const major = (versionLine: string) =>
      execFileSync('sed', ['-nE', expression as string], {
        input: `${versionLine}\n`,
        encoding: 'utf8',
      }).trim();

    expect(major('pg_dump (PostgreSQL) 18.6')).toBe('18');
    expect(major('pg_dump (PostgreSQL) 18.6 (Ubuntu 18.6-1.pgdg24.04+2)')).toBe('18');
    expect(major('pg_dump (PostgreSQL) 16.10 (Debian 16.10-1.pgdg120+1)')).toBe('16');
    expect(major('pg_dump (PostgreSQL) 17.2 (Ubuntu 17.2-1.pgdg22.04+1)')).toBe('17');
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

  it('requires production registry, database, auth, metrics, recovery, logging, mail, storage and dashboard-build coordinates', () => {
    for (const key of [
      'APP_DOMAIN',
      'NEXT_PUBLIC_API_URL',
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

  it('binds the immutable dashboard artifact to the exact production API origin', () => {
    expect(preflight).toContain(
      'APP_DOMAIN must be a DNS hostname without scheme, port, credentials or path',
    );
    expect(preflight).toContain('EXPECTED_API_URL="https://${APP_DOMAIN}/api"');
    expect(preflight).toContain('NEXT_PUBLIC_API_URL must equal https://${APP_DOMAIN}/api');
    expect(preflight).toContain('dashboard build API URL matches the production public API origin');
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

  // The offsite command is executed in two different filesystems -- on the host
  // by deploy-blue-green.sh, and inside the maintenance container by the nightly
  // cron job -- so validating only the host lets a command that an operator
  // tests successfully by hand fail every night in production.
  it('resolves the offsite copy command inside the maintenance image, not just the host', () => {
    expect(preflight).toContain('wizer-signage-maintenance');
    expect(preflight).toContain('resolve_maintenance_image');
    expect(preflight).toContain('does not exist in the maintenance image');
    expect(preflight).toContain('offsite copy command resolves inside the maintenance image');
    // Still read-only: every container it starts is throwaway and unmounted.
    // (A bare /-v / would match the `command -v` inside the probe, so mounts are
    // matched by their required `source:target` form instead.)
    const dockerRuns = preflight.split('\n').filter((line) => line.includes('docker run'));
    expect(dockerRuns.length).toBeGreaterThan(0);
    for (const line of dockerRuns) {
      expect(line).toContain('--rm');
      expect(line).not.toContain('--volume');
      expect(line).not.toMatch(/-v\s+[^\s'"]+:[^\s'"]+/);
    }
  });

  it('requires the offsite copy to be verified against the local dump size', () => {
    expect(preflight).toContain('BACKUP_OFFSITE_VERIFY_CMD');
    expect(preflight).toContain('rather than confirmed');
    expect(preflight).toContain('BACKUP_OFFSITE_VERIFY_CMD is a no-op');
    expect(preflight).toContain('offsite backup copy is verified against the local dump size');
  });

  // Behavioural, not string-level: the previous check compared against four
  // literals, so `/bin/true`, `true ` and `true #x` all passed as real commands.
  // The function is extracted and executed so the normalization is actually run.
  describe('no-op detection for BACKUP_OFFSITE_CMD', () => {
    const firstWord = (cmd: string): string =>
      execFileSync(
        'bash',
        [
          '-c',
          `source <(sed -n '/^offsite_first_word()/,/^}/p' "$1"); offsite_first_word "$2"`,
          '_',
          preflightPath,
          cmd,
        ],
        { encoding: 'utf8' },
      );

    const NO_OPS = [
      'true',
      '/bin/true',
      'true ',
      '  true  ',
      'true #keep the old behaviour',
      '/usr/bin/true',
      ':',
      'echo uploaded',
    ];
    it.each(NO_OPS)('normalizes %p to a rejected no-op', (cmd) => {
      expect(['true', ':', 'echo']).toContain(firstWord(cmd));
    });

    const REAL = [
      'rclone copyto "$1" "remote:wizer/$(basename "$1")"',
      'rclone size --json "remote:wizer/x" | sed -n "s/.*bytes//p"',
    ];
    it.each(REAL)('keeps %p as a real command', (cmd) => {
      expect(firstWord(cmd)).toBe('rclone');
    });
  });

  it('requires a production off-box log collector and validates its port', () => {
    expect(preflight).toContain('LOG_SHIPPING_ADDRESS must be a collector host:port');
    expect(preflight).toContain('LOG_SHIPPING_ADDRESS port must be 1-65535');
    expect(preflight).toContain('off-box logging collector coordinate is configured');
  });

  // Shape is not reachability, and the connection is opened by the Docker daemon
  // on the host rather than from inside a container network -- so an address that
  // looks valid (a Compose service name, say) can silently ship nothing forever.
  it('proves the log collector is actually reachable, not merely well-formed', () => {
    expect(preflight).toContain('/dev/tcp/');
    expect(preflight).toContain('is unreachable from this host');
    expect(preflight).toContain('log collector accepts connections from this host');
    // Retried, so a momentary blip at a third-party collector cannot block a
    // release through a gate that is otherwise fail-closed.
    expect(preflight).toContain('log_collector_reachable');
    // And overridable, because fluentd-async exists precisely so collector
    // downtime never stops Wizer from running.
    expect(preflight).toContain('ALLOW_UNREACHABLE_LOG_COLLECTOR');
  });

  // The shape regex admits shell metacharacters, and this value is used in a
  // connect attempt run by the docker-privileged deploy user.
  it('constrains the collector host before using it in a connect attempt', () => {
    expect(preflight).toContain('LOG_SHIPPING_ADDRESS host must be a DNS hostname or IPv4 literal');
    // Passed as an argument, never spliced into the command string.
    expect(preflight).toMatch(/bash -c 'printf "" >\/dev\/tcp\/"\$1"\/"\$2"' _/);
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
