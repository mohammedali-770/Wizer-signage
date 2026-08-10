const test = require('node:test');
const assert = require('node:assert/strict');

const shared = require('../dist/index.js');

test('password policy rejects incomplete passwords and accepts a compliant one', () => {
  assert.equal(shared.passwordMeetsPolicy('short'), false);
  assert.equal(shared.passwordMeetsPolicy('alllowercase123!'), false);
  assert.equal(shared.passwordMeetsPolicy('NoNumberHere!'), false);
  assert.equal(shared.passwordMeetsPolicy('ValidPass1!'), true);
});

test('Arabic number formatting keeps Latin digits', () => {
  const formatted = shared.formatLatnNumber(1234567, 'ar');
  assert.match(formatted, /1/);
  assert.doesNotMatch(formatted, /[٠-٩]/);
});

test('pairing alphabet excludes visually ambiguous characters', () => {
  for (const character of ['I', 'O', '0', '1']) {
    assert.equal(shared.PAIRING_CODE_ALPHABET.includes(character), false);
  }
  assert.equal(shared.PAIRING_CODE_ALPHABET.length > shared.PAIRING_CODE_LENGTH, true);
});
