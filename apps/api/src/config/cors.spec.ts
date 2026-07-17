import { resolveCorsOrigins, REFLECT_ANY } from './cors';

/**
 * CORS allowlist resolution. The production branch is the security boundary, so
 * every rejection path is asserted explicitly; the dev/test branch is asserted
 * to preserve the convenient localhost behaviour.
 */
describe('resolveCorsOrigins', () => {
  describe('production', () => {
    const prod = (raw: string | undefined) => resolveCorsOrigins(raw, 'production');

    it('throws when CORS_ORIGINS is missing', () => {
      expect(() => prod(undefined)).toThrow(/CORS_ORIGINS is required in production/);
    });

    it('throws when CORS_ORIGINS is empty / whitespace only', () => {
      expect(() => prod('')).toThrow(/required in production/);
      expect(() => prod('   ')).toThrow(/required in production/);
      expect(() => prod(' , ,')).toThrow(/required in production/);
    });

    it('rejects the wildcard "*"', () => {
      expect(() => prod('*')).toThrow(/wildcard/);
      expect(() => prod('https://app.example.com,*')).toThrow(/wildcard/);
    });

    it('rejects localhost / loopback / unspecified hosts', () => {
      expect(() => prod('https://localhost')).toThrow(/disallowed host/);
      expect(() => prod('https://127.0.0.1')).toThrow(/disallowed host/);
      expect(() => prod('https://[::1]')).toThrow(/disallowed host/);
      expect(() => prod('https://0.0.0.0')).toThrow(/disallowed host/);
    });

    it('rejects a non-HTTPS (http) production origin', () => {
      expect(() => prod('http://app.example.com')).toThrow(/must use https/);
    });

    it('rejects entries carrying a path, query, or fragment', () => {
      expect(() => prod('https://app.example.com/dashboard')).toThrow(/no path/);
      expect(() => prod('https://app.example.com/?x=1')).toThrow(/query string/);
      expect(() => prod('https://app.example.com/#frag')).toThrow(/fragment/);
    });

    it('rejects credentials embedded in the origin', () => {
      expect(() => prod('https://user:pass@app.example.com')).toThrow(/credentials/);
    });

    it('rejects a malformed URL', () => {
      expect(() => prod('not-a-url')).toThrow(/not a valid URL/);
      expect(() => prod('https://')).toThrow(/not a valid URL/);
    });

    it('accepts a single valid HTTPS origin', () => {
      expect(prod('https://app.example.com')).toEqual(['https://app.example.com']);
    });

    it('accepts multiple valid HTTPS origins (with ports)', () => {
      expect(prod('https://app.example.com, https://admin.example.com:8443')).toEqual([
        'https://app.example.com',
        'https://admin.example.com:8443',
      ]);
    });

    it('normalises trailing slashes and de-duplicates', () => {
      expect(prod('https://app.example.com/, https://app.example.com')).toEqual([
        'https://app.example.com',
      ]);
    });

    it('does not include the wildcard sentinel in a valid production list', () => {
      expect(prod('https://app.example.com')).not.toContain(REFLECT_ANY);
    });
  });

  describe('development / test', () => {
    it('reflects any origin when unset (dev convenience)', () => {
      expect(resolveCorsOrigins(undefined, 'development')).toEqual([REFLECT_ANY]);
      expect(resolveCorsOrigins('', undefined)).toEqual([REFLECT_ANY]);
      expect(resolveCorsOrigins('   ', 'test')).toEqual([REFLECT_ANY]);
    });

    it('honours an explicit localhost list without forcing HTTPS', () => {
      expect(resolveCorsOrigins('http://localhost:3000', 'development')).toEqual([
        'http://localhost:3000',
      ]);
    });

    it('de-duplicates an explicit dev list', () => {
      expect(
        resolveCorsOrigins('http://localhost:3000, http://localhost:3000', 'development'),
      ).toEqual(['http://localhost:3000']);
    });
  });
});
