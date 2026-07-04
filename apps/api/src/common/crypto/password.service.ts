import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { passwordMeetsPolicy, PASSWORD_POLICY } from '@wizer/shared';

import { COMMON_PASSWORDS } from '../security/common-passwords';

/** Result of a password-policy evaluation. */
export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

/**
 * Password hashing (Argon2id) and policy enforcement.
 *
 * Policy (see docs/security.md): >= 10 chars with upper/lower/number/symbol,
 * not a known weak/common password. "Immediate reuse" prevention lives in the
 * auth service (it needs the user's password history).
 */
@Injectable()
export class PasswordService {
  /** Argon2id parameters — OWASP-aligned defaults. */
  private readonly options = {
    memoryCost: 19_456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  };

  async hash(plain: string): Promise<string> {
    return hash(plain, this.options);
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      // Malformed hash or verification error -> treat as non-match.
      return false;
    }
  }

  /** Evaluate the password against the full policy, returning human errors. */
  evaluate(plain: string): PasswordPolicyResult {
    const errors: string[] = [];

    if (!passwordMeetsPolicy(plain)) {
      errors.push(PASSWORD_POLICY.description);
    }
    if (this.isCommon(plain)) {
      errors.push('This password is too common or has appeared in breaches. Choose another.');
    }

    return { valid: errors.length === 0, errors };
  }

  /** True when the password is on the blocked weak/common list. */
  isCommon(plain: string): boolean {
    return COMMON_PASSWORDS.has(plain.toLowerCase().trim());
  }
}
