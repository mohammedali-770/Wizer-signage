import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  describe('evaluate', () => {
    it('rejects passwords that are too short', () => {
      const result = service.evaluate('Sh0rt!');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects passwords missing complexity', () => {
      expect(service.evaluate('alllowercase1').valid).toBe(false); // no upper/symbol
      expect(service.evaluate('NoNumbers!!!').valid).toBe(false); // no digit
      expect(service.evaluate('NoSymbols123').valid).toBe(false); // no symbol
    });

    it('rejects common/breached passwords even if complex', () => {
      const result = service.evaluate('Password1!');
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/common|breach/i);
    });

    it('accepts a strong, uncommon password', () => {
      expect(service.evaluate('Zx9$mKvq2026!').valid).toBe(true);
    });
  });

  describe('isCommon', () => {
    it('is case-insensitive', () => {
      expect(service.isCommon('PASSWORD')).toBe(true);
      expect(service.isCommon('Admin123!')).toBe(true);
      expect(service.isCommon('Zx9$mKvq2026!')).toBe(false);
    });
  });

  describe('hash/verify', () => {
    it('hashes and verifies (Argon2id) round-trip', async () => {
      const hash = await service.hash('Zx9$mKvq2026!');
      expect(hash).toMatch(/^\$argon2/);
      expect(await service.verify(hash, 'Zx9$mKvq2026!')).toBe(true);
      expect(await service.verify(hash, 'wrong-password')).toBe(false);
    });

    it('returns false for a malformed hash instead of throwing', async () => {
      expect(await service.verify('not-a-hash', 'whatever')).toBe(false);
    });
  });
});
