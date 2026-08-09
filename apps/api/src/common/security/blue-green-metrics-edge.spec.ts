import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const template = readFileSync(
  resolve(root, 'infra/nginx/templates-blue-green/wizer-signage.conf.template'),
  'utf8',
);

describe('blue-green Prometheus edge isolation', () => {
  it('denies the exact public metrics URL before the generic API proxy', () => {
    const deny = template.indexOf('location = /api/internal/metrics');
    const genericApi = template.indexOf('location /api/');
    expect(deny).toBeGreaterThan(-1);
    expect(genericApi).toBeGreaterThan(-1);
    expect(deny).toBeLessThan(genericApi);
    expect(template.slice(deny, genericApi)).toContain('return 404;');
  });
});
