/**
 * @wizer/shared
 *
 * Shared constants and PURE utilities used by both the NestJS API
 * (`apps/api`) and the Next.js dashboard (`apps/dashboard`).
 *
 * Consumed directly as TypeScript source (no build step). Everything here MUST
 * be runtime-agnostic: no Node-only APIs (no `fs`, `crypto`, `process`, etc.)
 * so the dashboard can import it in the browser and in React Server Components.
 *
 * Phase 0 scope: platform-wide constants and small, well-tested helpers only.
 */

/* ========================================================================== *
 * Branding
 * ========================================================================== */

/** Human-facing product/brand name. */
export const APP_NAME = 'Wizer Signage' as const;

/* ========================================================================== *
 * Pagination
 * ========================================================================== */

/** Default number of items per page when a client does not specify one. */
export const DEFAULT_PAGE_SIZE = 20 as const;

/* ========================================================================== *
 * Pairing
 * ========================================================================== */

/** Length of a device pairing code shown on screens and entered by users. */
export const PAIRING_CODE_LENGTH = 6 as const;

/**
 * Alphabet used to generate pairing codes.
 *
 * Ambiguous characters are intentionally omitted to avoid user confusion when
 * reading codes off a TV screen:
 *   - removed letters: I, O
 *   - removed digits:  0, 1
 * The remaining set is unambiguous and case-insensitive friendly.
 */
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' as const;

/* ========================================================================== *
 * Invitations
 * ========================================================================== */

/** Number of days a user invitation link remains valid before expiring. */
export const INVITE_EXPIRY_DAYS = 3 as const;

/* ========================================================================== *
 * Retention & lifecycle windows (in days)
 * ========================================================================== */

/** Days an item stays in Trash before becoming eligible for hard deletion. */
export const TRASH_RETENTION_DAYS = 14 as const;

/** Days that soft-deleted/expired tenant data is retained before purge. */
export const DATA_RETENTION_DAYS = 90 as const;

/** Grace period after a subscription lapses before service is suspended. */
export const GRACE_PERIOD_DAYS = 7 as const;

/* ========================================================================== *
 * Authentication & account security
 * ========================================================================== */

/** Failed-login attempts before an account is temporarily locked. */
export const ACCOUNT_LOCK_THRESHOLD = 7 as const;

/** Duration (minutes) an account stays locked after the threshold is hit. */
export const ACCOUNT_LOCK_MINUTES = 15 as const;

/** Inactivity (minutes) after which an authenticated session is invalidated. */
export const SESSION_INACTIVITY_MINUTES = 30 as const;

/** Minimum allowed password length. */
export const PASSWORD_MIN_LENGTH = 10 as const;

/**
 * Human-readable description of the password policy, suitable for surfacing in
 * UI copy and documentation. The machine-enforced rules live in
 * {@link passwordMeetsPolicy}.
 */
export const PASSWORD_POLICY = {
  minLength: PASSWORD_MIN_LENGTH,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: true,
  description: `At least ${PASSWORD_MIN_LENGTH} characters, including an uppercase letter, a lowercase letter, a number, and a symbol.`,
} as const;

/**
 * Returns `true` when the supplied password satisfies {@link PASSWORD_POLICY}:
 * minimum length plus at least one uppercase letter, lowercase letter, digit,
 * and symbol (any non-alphanumeric, non-whitespace character).
 *
 * Pure and dependency-free so it can run identically on the client and server.
 */
export function passwordMeetsPolicy(pw: string): boolean {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN_LENGTH) {
    return false;
  }

  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(pw);

  return hasUpper && hasLower && hasNumber && hasSymbol;
}

/* ========================================================================== *
 * Internationalisation helpers
 * ========================================================================== */

/**
 * Formats a number using the given locale but ALWAYS with Latin (Western
 * Arabic) digits — i.e. `0123456789` — regardless of the locale's default
 * numbering system.
 *
 * This is required by product spec: the Arabic UI must render Latin digits even
 * though the surrounding text and layout are Arabic/RTL. We achieve this via the
 * Unicode `-u-nu-latn` extension and the explicit `numberingSystem: 'latn'`
 * option for `Intl.NumberFormat`.
 *
 * @param value  The numeric value to format.
 * @param locale BCP-47 locale tag (defaults to `'en'`).
 */
export function formatLatnNumber(value: number, locale = 'en'): string {
  return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
    numberingSystem: 'latn',
  }).format(value);
}
