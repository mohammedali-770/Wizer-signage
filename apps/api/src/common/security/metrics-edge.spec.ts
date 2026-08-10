import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const template = readFileSync(
  resolve(root, 'infra/nginx/templates/wizer-signage.conf.template'),
  'utf8',
);

describe('Prometheus edge isolation', () => {
  it('tombstones the public metrics URL before the generic API proxy', () => {
    const deny = template.indexOf('location = /api/internal/metrics');
    const genericApi = template.indexOf('location /api/');
    expect(deny).toBeGreaterThan(-1);
    expect(genericApi).toBeGreaterThan(-1);
    expect(deny).toBeLessThan(genericApi);
    expect(template.slice(deny, genericApi)).toContain('return 404;');
  });

  it('never proxies the exact public metrics location to the API upstream', () => {
    const start = template.indexOf('location = /api/internal/metrics');
    const end = template.indexOf('}', start);
    const block = template.slice(start, end + 1);
    expect(block).not.toContain('proxy_pass');
    expect(block).not.toContain('api_upstream');
  });
});
