import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const nightly = readFileSync(resolve(root, '.github/workflows/nightly.yml'), 'utf8');
const envValidation = readFileSync(resolve(root, 'apps/api/src/config/env.validation.ts'), 'utf8');

// Slice out the load-test job so an assertion cannot accidentally be satisfied
// by a different job in the same file. Text rather than a YAML parse, matching
// the other workflow/compose specs in this directory and avoiding a dependency
// added solely for a test.
function job(name: string): string {
  const start = nightly.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = nightly.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][A-Za-z0-9_-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const loadTest = job('load-test');
const notify = job('notify');
// Everything above the first `steps:` is job-level configuration.
const jobEnv = loadTest.slice(0, loadTest.indexOf('\n    steps:'));
const steps = loadTest.slice(loadTest.indexOf('\n    steps:'));

// This job failed on six consecutive nights and nobody noticed: the k6 smoke it
// exists to run had never executed once. Four independent breaks were stacked
// behind each other, each invisible until the one before it was fixed. Each
// guard below pins one of them.
describe('nightly k6 load-test job', () => {
  it('does not set NODE_ENV=production for the whole job', () => {
    // pnpm skips devDependencies under NODE_ENV=production, so the root
    // `prepare` script could not find husky and `pnpm install` failed at step 6
    // of 15 -- taking the build, the API and the smoke down with it.
    expect(jobEnv).not.toMatch(/^ {6}NODE_ENV:/m);
  });

  it('sets NODE_ENV=production only on the step that boots the API', () => {
    // Booting in production mode is the point: it is what keeps the SMTP,
    // storage, captcha and dashboard-origin guards from silently regressing.
    expect(steps).toMatch(
      /- name: Start the API\n(?: +[^\n]*\n)*? +env:\n +NODE_ENV: production\n/,
    );
    // And nowhere near the install, which is where it did the damage.
    const installStep = steps
      .split('- name: ')
      .find((block) => block.startsWith('Install dependencies'));
    expect(installStep).toBeDefined();
    expect(installStep).not.toContain('NODE_ENV: production');
  });

  it('builds the API together with its workspace dependencies', () => {
    // Without the `...` suffix @wizer/shared and @wizer/types are never built
    // and the API fails to compile. This was invisible until the install was
    // fixed, because the job never reached the build step.
    expect(steps).toContain('pnpm --filter "@wizer/api..." build');
  });

  it('supplies every value the API requires to boot in production', () => {
    // env.validation.ts refuses to start without these. Adding a new one there
    // without adding it here would put the nightly straight back to failing.
    for (const key of [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_FROM',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_STORAGE_BUCKET',
      'CAPTCHA_SECRET',
    ]) {
      expect(envValidation).toContain(key);
      expect(jobEnv).toMatch(new RegExp(`^ {6}${key}:`, 'm'));
    }
  });

  it('uses a dashboard origin the production validator accepts', () => {
    // The validator rejects .invalid as a local/private host, and that rejection
    // is correct -- a password-reset link pointing at an unresolvable host is a
    // broken email. The API could not boot at all with the previous value.
    const appUrl = jobEnv.match(/^ {6}APP_URL: (\S+)$/m)?.[1];
    expect(appUrl).toMatch(/^https:\/\//);
    expect(appUrl).not.toMatch(/\.(invalid|local)$/);
    expect(envValidation).toContain(".endsWith('.invalid')");
  });

  it('keeps mail delivery impossible', () => {
    // Only the SMTP coordinates decide whether a nightly can email a real
    // person, and .invalid cannot resolve. This must not drift to a real host
    // just because the dashboard origin had to.
    const smtpHost = jobEnv.match(/^ {6}SMTP_HOST: (\S+)$/m)?.[1];
    expect(smtpHost).toMatch(/\.invalid$/);
    const smtpFrom = jobEnv.match(/^ {6}SMTP_FROM: (\S+)$/m)?.[1];
    expect(smtpFrom).toMatch(/\.invalid$/);
  });
});

// Six nights of failures reached nobody. The job that broke is fixed, but the
// silence around it is a separate defect: the next breakage looks identical from
// the outside unless something reports it.
describe('nightly failure reporting', () => {
  it('reports on every outcome, not only on success', () => {
    expect(notify).toContain('if: always()');
    // Must depend on all three real jobs, or a failure in an unwatched one is
    // exactly as silent as before.
    expect(notify).toContain('needs: [load-test, dependency-audit, backup-drill]');
  });

  it('still fails the workflow when a job failed', () => {
    // A green notify job sitting on top of a failed nightly would be a worse
    // lie than no notification at all -- the run must stay red.
    expect(notify).toContain('- name: Fail if any job failed');
    expect(notify).toMatch(/Fail if any job failed[\s\S]*exit 1/);
  });

  it('reuses one tracking issue instead of opening one per night', () => {
    // A fresh issue every night is noise, and noise is what people mute.
    expect(notify).toContain('gh issue comment');
    expect(notify).toContain('gh issue create');
    expect(notify).toContain('gh issue close');
  });

  it('pings a dead-man only on a fully green run', () => {
    // A failure hook cannot fire when the workflow never runs -- GitHub disables
    // scheduled workflows after 60 days of repository inactivity. The dead-man is
    // what covers "stopped running entirely", so it must be gated on success.
    expect(notify).toMatch(
      /- name: Ping the dead-man endpoint\n +if: steps\.outcome\.outputs\.failed == 'false'/,
    );
    expect(notify).toContain('NIGHTLY_HEALTHCHECK_URL');
  });

  it('does not turn an unconfigured or unreachable dead-man into a red build', () => {
    // Otherwise the alerting itself becomes the noise it exists to prevent.
    const ping = notify.slice(notify.indexOf('- name: Ping the dead-man endpoint'));
    expect(ping).toContain('is not configured');
    expect(ping).toContain('exit 0');
    expect(ping).toMatch(/curl[^\n]*\|\| true/);
  });
});
