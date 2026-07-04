import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from '@wizer/shared';

import type { AppConfig } from '../../config/configuration';

const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard nonce length
const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Cryptographic helpers for tokens, one-way hashing of high-entropy secrets,
 * and reversible encryption of secrets at rest (TOTP secrets).
 *
 * Passwords are NOT handled here — see {@link PasswordService} (Argon2id).
 */
@Injectable()
export class CryptoService {
  /** 32-byte key derived from ENCRYPTION_KEY (any-length input -> sha256). */
  private readonly encryptionKey: Buffer;

  constructor(private readonly config: ConfigService) {
    const security = this.config.get<AppConfig['security']>('security', { infer: true });
    const rawKey = security?.encryptionKey ?? '';
    // Derive a stable 32-byte key from whatever the operator supplied (hex,
    // base64, or passphrase). The raw key length is validated at boot.
    this.encryptionKey = createHash('sha256').update(rawKey, 'utf8').digest();
  }

  /** URL-safe random token (default 32 bytes => 43 base64url chars). */
  randomToken(byteLength = 32): string {
    return randomBytes(byteLength).toString('base64url');
  }

  /** SHA-256 hex digest. Used to store high-entropy tokens (refresh/invite/reset). */
  sha256(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  /** SHA-256 hex digest of a binary buffer (file checksum). */
  sha256Buffer(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /** Constant-time-ish comparison via hashing (inputs are already hashes here). */
  hashEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
      mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
  }

  /** Generate a human-friendly pairing code (unambiguous alphabet). */
  generatePairingCode(length = PAIRING_CODE_LENGTH): string {
    let code = '';
    for (let i = 0; i < length; i++) {
      code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
    }
    return code;
  }

  /** Generate `count` formatted 2FA backup codes (e.g. "ABCD-EFGH"). */
  generateBackupCodes(count = 10, segmentLength = 4, segments = 2): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const parts: string[] = [];
      for (let s = 0; s < segments; s++) {
        let part = '';
        for (let c = 0; c < segmentLength; c++) {
          part += BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)];
        }
        parts.push(part);
      }
      codes.push(parts.join('-'));
    }
    return codes;
  }

  /** Normalize a backup code for hashing/comparison (uppercase, strip dashes). */
  normalizeBackupCode(code: string): string {
    return code.replace(/[\s-]/g, '').toUpperCase();
  }

  /** Encrypt a UTF-8 string with AES-256-GCM. Returns base64(iv | tag | ct). */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(AES_ALGORITHM, this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
  }

  /** Decrypt a payload produced by {@link encrypt}. */
  decrypt(payload: string): string {
    const buffer = Buffer.from(payload, 'base64');
    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = buffer.subarray(IV_LENGTH + 16);
    const decipher = createDecipheriv(AES_ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
