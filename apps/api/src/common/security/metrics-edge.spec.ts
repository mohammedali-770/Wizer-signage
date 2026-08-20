import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const templates = {
  base: readFileSync(resolve(root, 'infra/nginx/templates/wizer-signage.conf.template'), 'utf8'),
  blueGreen: readFileSync(
    resolve(root, 'infra/nginx/templates-blue-green/wizer-signage.conf.template'),
    'utf8',
  ),
};

// The tombstone in these templates is the layer that keeps the metrics endpoint
// off the public edge at all; the token guard is the layer that keeps it closed
// if something reaches it. This file covers the first, which means it has to
// match every spelling the API will accept -- not just the canonical one.
//
// A drill against a real nginx in front of a real API found that it did not.
// `location = /api/internal/metrics` matches exactly one string, while Express
// is case-insensitive and non-strict about a trailing slash by default, so
// `/api/internal/metrics/` and `/api/Internal/metrics` both walked past the
// tombstone and reached the endpoint through the public edge (401 anonymously,
// 200 with a token). Anonymous access was never possible -- the guard held --
// but the whole point of the tombstone is that the token is not the only thing
// standing there.
//
// The nginx behaviour these assertions stand in for was verified by request:
// after the fix all of /api/internal/metrics, /api/internal/metrics/,
// /api/Internal/metrics and /API/INTERNAL/METRICS return an nginx 404, while
// /api/internal/metricsfoo still proxies through to Nest.
const METRICS_LOCATION = /location\s+~\*\s+\^\/api\/internal\/metrics\/\?\$\s*\{/;

describe.each(Object.entries(templates))(
  'Prometheus edge isolation (%s template)',
  (_name, template) => {
    it('tombstones the public metrics URL before the generic API proxy', () => {
      const deny = template.search(METRICS_LOCATION);
      const genericApi = template.indexOf('location /api/');
      expect(deny).toBeGreaterThan(-1);
      expect(genericApi).toBeGreaterThan(-1);
      expect(deny).toBeLessThan(genericApi);
      expect(template.slice(deny, genericApi)).toContain('return 404;');
    });

    it('never proxies the public metrics location to the API upstream', () => {
      const start = template.search(METRICS_LOCATION);
      const end = template.indexOf('}', start);
      const block = template.slice(start, end + 1);
      expect(block).not.toContain('proxy_pass');
      expect(block).not.toContain('api_upstream');
    });

    // The specific defect: an exact-match location covers one spelling, and the
    // API answers to several.
    it('matches every spelling Express will route to the endpoint', () => {
      const match = template.match(METRICS_LOCATION);
      expect(match).not.toBeNull();

      // Case-insensitive: Express routing is case-insensitive by default, so
      // /api/Internal/metrics reaches the same handler.
      expect(match?.[0]).toContain('~*');

      // Optional trailing slash: Express is non-strict by default, so
      // /api/internal/metrics/ reaches the same handler.
      expect(match?.[0]).toContain('/?$');

      // An exact-match location is what allowed the bypass; it must not come back.
      expect(template).not.toContain('location = /api/internal/metrics');
    });

    // Anchored, so the tombstone cannot silently widen into sibling routes.
    it('does not swallow neighbouring paths', () => {
      const match = template.match(METRICS_LOCATION)?.[0] ?? '';
      expect(match).toContain('^/api/internal/metrics');
      expect(match).toContain('$');
    });
  },
);
