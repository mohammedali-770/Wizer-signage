/**
 * A curated blocklist of weak / commonly-breached passwords.
 *
 * This is a pragmatic Phase-1 list of the most frequently used passwords. A
 * production deployment should additionally check against a breached-password
 * corpus (e.g. HaveIBeenPwned k-anonymity API) — wired in a later phase.
 *
 * Compared case-insensitively (see PasswordService.isCommon). Note that any
 * value here that does not meet the complexity policy is already rejected by
 * the policy check; the list mainly blocks "complex-looking but common"
 * passwords (e.g. "Password1!", "Qwerty123!").
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '123456',
  '123456789',
  'qwerty',
  'password',
  'password1',
  'password123',
  'password1!',
  'password123!',
  'passw0rd',
  'passw0rd!',
  'p@ssw0rd',
  'p@ssword1',
  'admin',
  'admin123',
  'admin123!',
  'administrator',
  'welcome',
  'welcome1',
  'welcome123',
  'welcome123!',
  'letmein',
  'letmein123',
  'qwerty123',
  'qwerty123!',
  'qwertyuiop',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'master',
  'master123',
  'superman',
  'batman',
  'trustno1',
  'whatever',
  'changeme',
  'changeme123',
  'changeme123!',
  'abc123',
  'abc123!',
  'abcd1234',
  'abcd1234!',
  '1q2w3e4r',
  '1q2w3e4r5t',
  'zaq12wsx',
  'qazwsx',
  '111111',
  '000000',
  '123123',
  '654321',
  '12345678',
  '1234567890',
  'mastersignage',
  'mastersignage1',
  'mastersignage1!',
  'signage',
  'signage123',
]);
