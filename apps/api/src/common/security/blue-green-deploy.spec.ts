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

const deploy = readFileSync(deployPath, 'utf8');
const rollback = readFileSync(rollbackPath, 'utf8');
const nginxTemplate = readFileSync(nginxTemplatePath, 'utf8');
const proxyOverlay = readFileSync(proxyOverlayPath, 'utf8');
const slotsCompose = readFileSync(slotsComposePath, 'utf8');

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
});
