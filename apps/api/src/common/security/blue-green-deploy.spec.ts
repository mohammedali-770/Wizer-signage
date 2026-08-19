import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const deployPath = resolve(root, 'scripts/deploy-blue-green.sh');
const rollbackPath = resolve(root, 'scripts/rollback-blue-green.sh');
const nginxTemplatePath = resolve(
  root,
  'infra/nginx/templates-blue-green/wizer-signage.conf.template',
);
const proxyOverlayPath = resolve(root, 'infra/docker/docker-compose.blue-green-proxy.yml');
const slotsComposePath = resolve(root, 'infra/docker/docker-compose.blue-green-slots.yml');
const baseLoggingPath = resolve(root, 'infra/docker/docker-compose.log-shipping.yml');
const slotLoggingPath = resolve(root, 'infra/docker/docker-compose.blue-green-log-shipping.yml');

const deploy = readFileSync(deployPath, 'utf8');
const rollback = readFileSync(rollbackPath, 'utf8');
const nginxTemplate = readFileSync(nginxTemplatePath, 'utf8');
const proxyOverlay = readFileSync(proxyOverlayPath, 'utf8');
const slotsCompose = readFileSync(slotsComposePath, 'utf8');
const baseLogging = readFileSync(baseLoggingPath, 'utf8');
const slotLogging = readFileSync(slotLoggingPath, 'utf8');

describe('blue/green deployment contract', () => {
  it('keeps both operational scripts syntactically valid bash', () => {
    expect(() => execFileSync('bash', ['-n', deployPath])).not.toThrow();
    expect(() => execFileSync('bash', ['-n', rollbackPath])).not.toThrow();
  });

  it('persists the active nginx upstream file across proxy recreation', () => {
    expect(proxyOverlay).toContain('nginx-runtime:/etc/nginx/runtime');
    expect(proxyOverlay).toContain('wizer-signage-nginx-runtime');
    expect(nginxTemplate).toContain('include /etc/nginx/runtime/active-upstreams.conf;');
  });

  it('defines isolated blue and green API/dashboard DNS aliases', () => {
    for (const name of ['api-blue', 'dashboard-blue', 'api-green', 'dashboard-green']) {
      expect(slotsCompose).toContain(name);
    }
    expect(slotsCompose).toContain('external: true');
    expect(slotsCompose).toContain('name: wizer-signage');
  });

  it('keeps off-box logging on base services and every serving slot during deploy and rollback', () => {
    expect(baseLogging).toContain('driver: fluentd');
    expect(baseLogging).toContain("fluentd-async: 'true'");
    for (const service of ['api_blue', 'dashboard_blue', 'api_green', 'dashboard_green']) {
      expect(slotLogging).toContain(`${service}:`);
    }
    expect(slotLogging).toContain('driver: fluentd');
    expect(slotLogging).toContain("fluentd-async: 'true'");
    expect(deploy).toContain('docker-compose.log-shipping.yml');
    expect(deploy).toContain('docker-compose.blue-green-log-shipping.yml');
    expect(rollback).toContain('docker-compose.log-shipping.yml');
    expect(rollback).toContain('docker-compose.blue-green-log-shipping.yml');
  });

  it('gives every fluentd duration option a unit', () => {
    // Docker parses fluentd-retry-wait as a Go duration and REJECTS a bare
    // number with "time: missing unit in duration". That failure happens at
    // container create, not at compose render, so `docker compose config`
    // succeeds and production preflight passes — and then the first deploy or
    // rollback cannot start a single slot. Both overlays shipped `:-1`.
    for (const [name, overlay] of [
      ['base', baseLogging],
      ['slots', slotLogging],
    ] as const) {
      const values = [...overlay.matchAll(/fluentd-retry-wait:\s*(\S+)/g)].map((m) => m[1]);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        // Either an interpolation whose default carries a unit, or a literal
        // duration. What must never appear again is a bare integer.
        expect(value).toMatch(/(ms|s|m|h)$/);
        expect(`${name}:${value}`).not.toMatch(/:\$\{[^}]*:-\d+\}$/);
      }
    }
  });

  it('rechecks the production wrapper accepted SHA after its own fetch/pull', () => {
    const pull = deploy.indexOf('git pull --ff-only');
    const identity = deploy.indexOf('FULL_SHA="$(git rev-parse HEAD)"');
    const expected = deploy.indexOf('EXPECTED_RELEASE_SHA');
    const imagePull = deploy.indexOf('pull-release-images.sh');
    expect(pull).toBeGreaterThan(0);
    expect(identity).toBeGreaterThan(pull);
    expect(expected).toBeGreaterThan(identity);
    expect(imagePull).toBeGreaterThan(expected);
    expect(deploy).toContain('protected main moved after production-wrapper validation');
  });

  it('health-gates the inactive slot before the traffic file is switched', () => {
    const health = deploy.indexOf('wait_healthy "wizer-signage-api-${INACTIVE_SLOT}"');
    const trafficSwitch = deploy.indexOf('write_and_reload "${NEW_UPSTREAMS}"');
    expect(health).toBeGreaterThan(0);
    expect(trafficSwitch).toBeGreaterThan(health);
  });

  it('restores the previous nginx config when the post-switch gate fails', () => {
    expect(deploy).toContain('automatic_rollback');
    expect(deploy).toContain('write_and_reload "${OLD_UPSTREAMS}"');
    expect(rollback).toContain('restoring original traffic');
    expect(rollback).toContain('write_and_reload "${OLD_UPSTREAMS}"');
  });

  it('uses the previous dashboard as a 404 fallback for hashed Next assets', () => {
    expect(nginxTemplate).toContain('proxy_pass http://dashboard_static_upstream;');
    expect(nginxTemplate).toMatch(/proxy_next_upstream[^;]*http_404/);
    expect(deploy).toContain('server ${OLD_DASHBOARD}:3000 backup;');
  });

  it('blocks common destructive migration shapes from the zero-downtime path', () => {
    expect(deploy).toContain('ZERO_DOWNTIME_ALLOW_DESTRUCTIVE_MIGRATION');
    expect(deploy).toContain('DROP[[:space:]]+(TABLE|COLUMN)');
    expect(deploy).toContain('expand/backfill/contract');
  });

  it('derives rollback current state from live nginx rather than stale deployment history', () => {
    const liveRead = rollback.indexOf('OLD_UPSTREAMS="$(docker exec wizer-signage-nginx cat');
    const slotDecision = rollback.indexOf("grep -q 'server api-blue:3001'");
    const historyWalk = rollback.indexOf('while IFS= read -r line');
    expect(liveRead).toBeGreaterThan(0);
    expect(slotDecision).toBeGreaterThan(liveRead);
    expect(historyWalk).toBeGreaterThan(slotDecision);
  });

  // These three cases pin the SHAPE of the rollback contract so the deploy and
  // rollback sides cannot drift apart unnoticed. The behavioural guard is
  // scripts/tests/rollback-blue-green.test.sh, which executes the script against a
  // stubbed docker and asserts on the release it actually selects.
  it('skips releases already recorded as rolled away from on repeated rollback', () => {
    expect(rollback).toContain('is_rolled_away');
    expect(rollback).toContain('if is_rolled_away "${tag}"; then continue; fi');
    expect(rollback).toContain('ROLLBACK from=%s/%s to=%s/%s');
  });

  it('lets a later redeployment of the same release clear its rolled-away mark', () => {
    // The mark must not be permanent. A release redeployed after being escaped has
    // passed the readiness and smoke gates again, and without this it could never be
    // reached however many times it shipped — repeated rollbacks would drain toward
    // the unverified legacy branch. Only the SAME tag clears it, and only when the
    // deployment is strictly later, so a tie stays excluded.
    expect(rollback).toContain('rolled_away_at');
    expect(rollback).toContain('redeployed_at');
    expect(rollback).toContain(`awk -v tag="$1" '$3 == tag`);
    expect(rollback).toContain('"${deployed}" > "${rolled}"');
  });

  it('never brings the rollback target up on the slot already serving', () => {
    // The target's history slot is sometimes the live one: skip a release in an
    // alternating history and the next candidate is two back, on the same colour.
    // Starting it there would recreate the containers handling live traffic, with no
    // health-gated standby and an upstream naming one host as primary and backup.
    expect(rollback).toContain('opposite_slot');
    expect(rollback).toContain('TARGET_SLOT="$(opposite_slot "${CURRENT_SLOT}")"');
    expect(rollback).toContain('if [[ "${TARGET_SLOT}" == "${CURRENT_SLOT}" ]]; then');
    expect(rollback).toContain('no rollback target other than');
  });
});
