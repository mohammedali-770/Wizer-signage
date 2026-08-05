/**
 * Is this URL pointing back at the platform itself?
 *
 * URL content is tenant-supplied and gets rendered inside an iframe on the
 * dashboard and inside a WebView on the player. A URL aimed at our OWN origin
 * turns both of those into a confused deputy:
 *
 *  - In the dashboard the frame would run on the dashboard's origin, with
 *    access to its storage and its authenticated session. The iframe sandbox is
 *    the first line of defence and this is the second — a sandbox attribute is
 *    one careless edit away from being widened again, and the payload is
 *    whatever token the viewing user holds, up to and including a Super Admin's.
 *  - On the player the WebView shares a process with a device-token-bearing
 *    client, so a page served from the API origin is a step closer to those
 *    endpoints than any third-party site is.
 *
 * Compares HOST only, deliberately: scheme and port do not make a page any less
 * ours, and an attacker who can pick the path can pick those too.
 *
 * Origins come from configuration (APP_URL / DASHBOARD_URL / API_URL) rather
 * than a literal, so nothing here has to know the deployed domain.
 */
export function isSelfOrigin(candidate: string, ownOrigins: Array<string | undefined>): boolean {
  const host = hostOf(candidate);
  if (!host) return false;

  return ownOrigins.some((origin) => {
    const own = hostOf(origin);
    return own !== null && own === host;
  });
}

/**
 * Lower-cased hostname, or null when the input is not a parseable absolute URL.
 *
 * A bare hostname is also accepted, so a misconfigured `APP_URL=signage.test`
 * (no scheme) still contributes a host to compare against instead of silently
 * matching nothing — failing open here would make the whole check decorative.
 */
function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    // Not absolute. Retry with a scheme so a host-only config value still parses.
    try {
      return new URL(`https://${trimmed}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}
