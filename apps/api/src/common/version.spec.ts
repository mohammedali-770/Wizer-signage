import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { API_VERSION, UNKNOWN_VERSION } from './version';

/**
 * The API version is read from `apps/api/package.json` and surfaces in three
 * places that must agree: `GET /api/health`, the served Swagger docs, and
 * `info.version` in the committed contract.
 *
 * It used to be read from `npm_package_version`, which the production image
 * never sets — it starts with a bare `node dist/main.js` — so the health
 * endpoint answered `0.0.0` for every release ever cut while the contract
 * carried the real number. These tests exist so that cannot come back quietly:
 * the failure mode is a *plausible-looking* wrong value, which no amount of
 * eyeballing a deploy catches.
 */
describe('API_VERSION', () => {
  const pkgRoot = join(__dirname, '..', '..');
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
    version?: string;
    name?: string;
  };

  it('reads the version out of the API package manifest', () => {
    expect(pkg.name).toBe('@wizer/api');
    expect(API_VERSION).toBe(pkg.version);
  });

  it('is a real version, not the fallback', () => {
    expect(API_VERSION).not.toBe(UNKNOWN_VERSION);
    expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('is no longer the 0.0.0 placeholder the contract used to advertise', () => {
    // Not a style preference: `0.0.0` was indistinguishable from the old
    // npm_package_version fallback, so a broken read and a real release looked
    // identical. Any real number breaks that tie.
    expect(API_VERSION).not.toBe('0.0.0');
  });

  /**
   * `version.ts` hardcodes ONE relative path, `../../package.json`, and relies
   * on being exactly two directories below the package root in every layout:
   * `src/common` when run from source, `dist/common` once compiled (Nest
   * mirrors `src/` into `dist/`), and `/app/dist/common` in the image.
   *
   * Asserting the depth is the honest test. Checking that
   * `dist/common/../../package.json` exists would prove nothing — the path
   * normalises away before it ever touches the filesystem.
   */
  it('sits exactly two directories below the manifest it reads', () => {
    expect(relative(pkgRoot, __dirname)).toBe(join('src', 'common'));
    expect(existsSync(join(pkgRoot, 'package.json'))).toBe(true);
  });

  it('the production image still copies the manifest where that path expects it', () => {
    // Guards the Docker layout: WORKDIR /app, CMD node dist/main.js, so
    // __dirname is /app/dist/common and ../../package.json is /app/package.json.
    // Deleting this COPY would make the API report the fallback in production
    // and nowhere else — invisible in every local run and in CI.
    const dockerfile = readFileSync(join(pkgRoot, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(
      /COPY --from=build[^\n]*\/apps\/api\/package\.json \.\/package\.json/,
    );
    expect(dockerfile).toMatch(/CMD \["node", "dist\/main\.js"\]/);
  });

  it('nothing reads npm_package_version for the version any more', () => {
    // The whole point of the change. A new reader reintroducing it would be
    // correct locally (pnpm sets it) and wrong only in production.
    const sources = [
      join(pkgRoot, 'src', 'main.ts'),
      join(pkgRoot, 'src', 'modules', 'health', 'health.service.ts'),
    ];
    for (const file of sources) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/process\.env\.npm_package_version/);
    }
  });
});
