# Browser refresh-session boundary

The dashboard uses two different credentials with deliberately different exposure:

- The short-lived **access token** is available to JavaScript and is sent in the `Authorization` header.
- The long-lived **refresh token** is stored only by the browser in the `wizer_refresh` cookie. It is `HttpOnly`, `SameSite=Strict`, `Secure` in production, and scoped to `/api/auth/refresh`.

`POST /api/auth/refresh` does not accept a refresh token in JSON. It rotates the cookie and returns a new access token. Browser refresh requests with `Sec-Fetch-Site: cross-site`, or an `Origin` different from the configured dashboard origin, are rejected.

Impersonation access tokens are intentionally non-refreshable. The administrator's ordinary refresh cookie remains HttpOnly in the browser while impersonation is active, so the dashboard must never call `/auth/refresh` for an impersonation token; otherwise an expired tenant session could silently switch identity back to the administrator.

Every refresh JWT has a unique `jti`. This guarantees rotation creates a distinct bearer even when two tokens are minted within the same second and preserves refresh-token reuse detection.
