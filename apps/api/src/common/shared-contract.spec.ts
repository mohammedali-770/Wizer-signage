import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY,
  formatLatnNumber,
  passwordMeetsPolicy,
} from '@wizer/shared';

/**
 * The `@wizer/shared` contract, tested from its principal consumer.
 *
 * `turbo run test` reports `<NONEXISTENT>` for the shared/types/ui packages, so
 * nothing here was covered. It cannot be tested in-package with `node --test`:
 * `@wizer/shared` is `"type": "commonjs"` and Node's TypeScript support is
 * erasure-only, so an ESM-syntax `.ts` there fails to load — and switching the
 * package to ESM would break this API, which is CJS.
 *
 * Testing it from the API is not a workaround so much as the right place: the
 * password policy is a SERVER-side control, and this asserts the contract
 * exactly as the enforcing side consumes it.
 */

describe('@wizer/shared — password policy', () => {
  it('accepts a password meeting every rule', () => {
    expect(passwordMeetsPolicy('Str0ng!Passw0rd')).toBe(true);
  });

  it('rejects a password one character below the minimum', () => {
    const short = 'Aa1!' + 'x'.repeat(PASSWORD_MIN_LENGTH - 5);
    expect(short).toHaveLength(PASSWORD_MIN_LENGTH - 1);
    expect(passwordMeetsPolicy(short)).toBe(false);
  });

  it.each([
    ['no uppercase', 'alllower1!xx'],
    ['no lowercase', 'ALLUPPER1!XX'],
    ['no number', 'NoDigitsHere!'],
    ['no symbol', 'NoSymbols1234'],
  ])('requires each character class independently (%s)', (_label, pw) => {
    expect(passwordMeetsPolicy(pw)).toBe(false);
  });

  it('does not count whitespace as the symbol', () => {
    // `\\s` is excluded from the symbol class deliberately: a trailing space
    // from a paste would otherwise satisfy the rule on its own.
    expect(passwordMeetsPolicy('Abcdefgh1 234')).toBe(false);
  });

  it('is total for non-string input', () => {
    // Reached from request handlers where the value arrives unvalidated.
    for (const bad of [undefined, null, 12345678901, {}, []]) {
      expect(passwordMeetsPolicy(bad as unknown as string)).toBe(false);
    }
  });

  it('stays consistent with the policy the UI advertises', () => {
    expect(PASSWORD_POLICY.minLength).toBe(PASSWORD_MIN_LENGTH);
    expect(PASSWORD_POLICY.description).toContain(String(PASSWORD_MIN_LENGTH));
  });
});

describe('@wizer/shared — Latin numerals', () => {
  it('formats with Latin digits in English', () => {
    expect(formatLatnNumber(1234567)).toBe('1,234,567');
  });

  it('formats with Latin digits in Arabic too', () => {
    // Product requirement: Arabic UI, Latin numerals. Without the `-u-nu-latn`
    // extension this returns Arabic-Indic digits and every figure in the RTL
    // dashboard silently changes script.
    const out = formatLatnNumber(1234567, 'ar');
    expect(out).toMatch(/[0-9]/);
    expect(out).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/);
  });
});

describe('@wizer/shared — pairing code alphabet', () => {
  // Codes are read off a wall-mounted TV and typed into a phone, so a glyph
  // confusable with another IN THE SAME ALPHABET turns pairing into guesswork.
  // The property is not "exclude these characters" but "keep at most one member
  // of each confusable group" — which is why L is present and legitimate: 1 and
  // I are both absent, so nothing is left for it to be mistaken for.
  it.each([
    ['zero/oh', ['0', 'O']],
    ['one/eye/ell', ['1', 'I', 'L']],
  ])('keeps at most one of the %s group', (_label, group) => {
    const present = (group as string[]).filter((c) => PAIRING_CODE_ALPHABET.includes(c));
    expect(present.length).toBeLessThanOrEqual(1);
  });

  it('has no duplicate characters', () => {
    expect(new Set(PAIRING_CODE_ALPHABET).size).toBe(PAIRING_CODE_ALPHABET.length);
  });

  it('leaves enough entropy for the code length', () => {
    expect(PAIRING_CODE_ALPHABET.length ** PAIRING_CODE_LENGTH).toBeGreaterThan(1e8);
  });
});
