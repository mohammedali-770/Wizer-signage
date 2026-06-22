import { ConfigService } from '@nestjs/config';
import { PAIRING_CODE_ALPHABET } from '@master-signage/shared';

import { CryptoService } from './crypto.service';

function makeService(): CryptoService {
  const config = {
    get: (key: string) =>
      key === 'security'
        ? { encryptionKey: 'unit-test-encryption-key-0123456789abcdef' }
        : undefined,
  } as unknown as ConfigService;
  return new CryptoService(config);
}

describe('CryptoService', () => {
  const service = makeService();

  it('encrypts and decrypts round-trip (AES-256-GCM)', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP'; // sample TOTP secret
    const encrypted = service.encrypt(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(service.decrypt(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertext each time (random IV)', () => {
    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('sha256 is deterministic and hex-encoded', () => {
    const a = service.sha256('token');
    expect(a).toBe(service.sha256('token'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates pairing codes from the unambiguous alphabet', () => {
    const code = service.generatePairingCode();
    expect(code).toHaveLength(6);
    for (const ch of code) {
      expect(PAIRING_CODE_ALPHABET).toContain(ch);
    }
  });

  it('generates formatted backup codes', () => {
    const codes = service.generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
  });

  it('normalizes backup codes (upper, strip separators)', () => {
    expect(service.normalizeBackupCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(service.normalizeBackupCode(' ab cd ')).toBe('ABCD');
  });

  it('hashEquals compares correctly', () => {
    expect(service.hashEquals('abc', 'abc')).toBe(true);
    expect(service.hashEquals('abc', 'abd')).toBe(false);
    expect(service.hashEquals('abc', 'abcd')).toBe(false);
  });
});
