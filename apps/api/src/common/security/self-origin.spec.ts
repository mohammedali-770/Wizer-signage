import { isSelfOrigin } from './self-origin';

/**
 * URL content is tenant-supplied and rendered in an iframe (dashboard) and a
 * WebView (player). A URL on our OWN host makes that frame same-origin with the
 * viewer's authenticated session, which is a token-theft primitive against
 * whoever opens the preview.
 */
describe('isSelfOrigin', () => {
  const OWN = ['https://signage.example.com', 'https://api.signage.example.com'];

  it('accepts an ordinary external URL', () => {
    expect(isSelfOrigin('https://news.example.org/live', OWN)).toBe(false);
  });

  it('rejects the dashboard origin', () => {
    expect(isSelfOrigin('https://signage.example.com/dashboard', OWN)).toBe(true);
  });

  it('rejects the API origin', () => {
    expect(isSelfOrigin('https://api.signage.example.com/api/health', OWN)).toBe(true);
  });

  it.each([
    ['a different scheme', 'http://signage.example.com/'],
    ['an explicit port', 'https://signage.example.com:8443/'],
    ['upper case', 'HTTPS://SIGNAGE.EXAMPLE.COM/'],
    ['a userinfo prefix', 'https://user:pw@signage.example.com/'],
    ['a query and fragment', 'https://signage.example.com/x?y=1#z'],
  ])('rejects it despite %s', (_label, url) => {
    // Host only, on purpose: an attacker who controls the path controls the
    // scheme and port too, and none of those make the page less ours.
    expect(isSelfOrigin(url, OWN)).toBe(true);
  });

  it.each([
    ['a subdomain of ours', 'https://evil.signage.example.com/'],
    ['our host as a subdomain of theirs', 'https://signage.example.com.evil.test/'],
    ['our host as a path segment', 'https://evil.test/signage.example.com'],
    ['our host in a query string', 'https://evil.test/?next=signage.example.com'],
  ])('does not confuse %s for our origin', (_label, url) => {
    // The failure a substring check would produce, in both directions: a
    // look-alike must not be blocked, and a look-alike must not be allowed
    // through by matching loosely either.
    expect(isSelfOrigin(url, OWN)).toBe(false);
  });

  it('tolerates a configured origin with no scheme', () => {
    // A misconfigured APP_URL=signage.example.com must still contribute a host.
    // Failing to parse it would make the whole check decorative.
    expect(isSelfOrigin('https://signage.example.com/x', ['signage.example.com'])).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])('ignores a %s configured origin instead of matching everything', (_label, origin) => {
    expect(isSelfOrigin('https://news.example.org/', [origin])).toBe(false);
  });

  it('returns false for an unparseable candidate rather than throwing', () => {
    // The DTO already enforces a valid http(s) URL, so this is only reachable
    // through another caller — it must not 500.
    expect(isSelfOrigin('not a url', OWN)).toBe(false);
  });

  it('handles an empty own-origin list', () => {
    expect(isSelfOrigin('https://signage.example.com/', [])).toBe(false);
  });
});
