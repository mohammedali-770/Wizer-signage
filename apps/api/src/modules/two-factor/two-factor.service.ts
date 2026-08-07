import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole, type User } from '@prisma/client';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';

import { CryptoService } from '../../common/crypto/crypto.service';
import { PasswordService } from '../../common/crypto/password.service';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

/**
 * Proof supplied with a 2FA management request.
 *
 * `currentCode` is only consulted when the account already has 2FA enabled.
 */
export interface ReauthProof {
  password: string;
  currentCode?: string;
}

/** True when 2FA must be enabled for this user (Super Admin or enforced). */
export function requiresTwoFactor(user: Pick<User, 'role' | 'twoFactorEnforced'>): boolean {
  return user.role === UserRole.SUPER_ADMIN || user.twoFactorEnforced;
}

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);
  private readonly issuer: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly password: PasswordService,
    private readonly users: UsersService,
    config: ConfigService,
  ) {
    this.issuer =
      config.get<AppConfig['twoFactor']>('twoFactor', { infer: true })?.issuer ?? 'Wizer Signage';
    // Allow ±1 step (±30s) to tolerate clock drift.
    authenticator.options = { window: 1 };
  }

  /**
   * Prove the requester is the account owner, to the strength the account
   * currently has.
   *
   * Always requires the password. When 2FA is already enabled it ALSO requires
   * a current TOTP/backup code, because on such an account the password is one
   * factor of two — accepting it alone would mean a leaked password is enough
   * to replace the second factor, which is the thing the second factor exists
   * to prevent.
   *
   * Fails closed on a null `passwordHash`. That column is nullable (a user is
   * INVITED until they accept), and such a user should have no session at all —
   * but "no password set" must never read as "no password required".
   */
  private async reauthenticate(user: User, proof: ReauthProof): Promise<void> {
    // A locked or disabled account gets no further attempts. Without this the
    // lockout below is a counter that never stops anything.
    if (this.users.isBlocked(user)) {
      throw new UnauthorizedException('Account is locked.');
    }

    const passwordOk =
      !!user.passwordHash && (await this.password.verify(user.passwordHash, proof.password));

    // Only when the password is right do we consider the second factor, so a
    // wrong password cannot be told apart from a wrong code.
    // verifyForUser OR consumeBackupCode directly, rather than
    // verifyCodeForUser: that helper returns early when twoFactorSecret is null
    // and would put the backup-code path out of reach for an account whose
    // secret is missing — the one case where backup codes are all that is left.
    const codeOk =
      passwordOk &&
      (!user.twoFactorEnabled ||
        (!!proof.currentCode &&
          ((await this.verifyForUser(user, proof.currentCode)) ||
            (await this.consumeBackupCode(user.id, proof.currentCode)))));

    if (!passwordOk || !codeOk) {
      // Count toward the same lockout threshold as a failed login: an attacker
      // holding a stolen token would otherwise have an unlimited password
      // oracle, since the per-IP throttle resets every minute.
      const { locked } = await this.users.recordFailedLogin(user);
      if (locked) {
        throw new UnauthorizedException('Account is locked.');
      }
      // One message for both failures — see above.
      throw new UnauthorizedException(
        user.twoFactorEnabled
          ? 'Password or authentication code is incorrect.'
          : 'Password is incorrect.',
      );
    }

    // The threshold counts CONSECUTIVE failures, so proving identity clears it
    // exactly as a successful login does. Without this a user who mistypes a
    // few times and then succeeds stays parked near the lockout line, and a
    // later unrelated typo locks them out early.
    if (user.failedLoginCount > 0) {
      await this.users.clearFailedAttempts(user.id);
    }
  }

  /** Begin enrollment: generate + persist (encrypted) a pending TOTP secret. */
  async setup(userId: string, proof: ReauthProof): Promise<TwoFactorSetup> {
    const user = await this.getUser(userId);
    // Gated even though it only issues a secret: this route both discloses that
    // secret and overwrites any enrollment already in flight.
    await this.reauthenticate(user, proof);
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, this.issuer, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorPendingSecret: this.crypto.encrypt(secret) },
    });

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  /**
   * Complete enrollment: verify a code against the pending secret, promote it,
   * enable 2FA, and issue a fresh set of one-time backup codes (returned once).
   */
  async enable(
    userId: string,
    code: string,
    proof: ReauthProof,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.getUser(userId);
    // Everything that can reject this request WITHOUT touching stored state runs
    // first, so a doomed request never consumes a single-use backup code.
    //
    // The new authenticator's code is checked here rather than after re-auth for
    // exactly that reason: re-auth may spend a backup code, and someone
    // recovering from a lost phone supplies one. Validating the new code second
    // meant a fat-fingered six digits — or a TOTP window that had just rolled —
    // burned a recovery code and returned a failure, and ten of those left them
    // with no way back into the account at all.
    if (!user.twoFactorPendingSecret) {
      throw new BadRequestException('Start 2FA setup before enabling.');
    }
    const secret = this.crypto.decrypt(user.twoFactorPendingSecret);
    if (!this.verifyToken(secret, code)) {
      throw new UnauthorizedException('Invalid authentication code.');
    }
    // Re-checked here rather than trusted from setup(): this route promotes a
    // secret and destroys the existing backup codes, so it has to stand on its
    // own proof instead of on another request having been gated earlier.
    await this.reauthenticate(user, proof);

    const backupCodes = this.crypto.generateBackupCodes(10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: true,
          twoFactorSecret: this.crypto.encrypt(secret),
          twoFactorPendingSecret: null,
        },
      }),
      this.prisma.backupCode.deleteMany({ where: { userId } }),
      this.prisma.backupCode.createMany({
        data: backupCodes.map((c) => ({
          userId,
          codeHash: this.crypto.sha256(this.crypto.normalizeBackupCode(c)),
        })),
      }),
    ]);

    return { backupCodes };
  }

  /** Disable 2FA (blocked for users for whom 2FA is mandatory). */
  async disable(userId: string, code: string, password: string): Promise<void> {
    const user = await this.getUser(userId);
    // Both checks run before re-authentication so a request that could never
    // succeed does not burn one of the user's single-use backup codes.
    if (requiresTwoFactor(user)) {
      throw new ForbiddenException('Two-factor authentication is mandatory for this account.');
    }
    if (!user.twoFactorEnabled) {
      throw new BadRequestException('Two-factor authentication is not enabled.');
    }
    // `code` IS the current factor here, so it is what reauthenticate() checks.
    // Removing the second factor demands both factors; a stolen session plus a
    // shoulder-surfed code was previously enough on its own.
    await this.reauthenticate(user, { password, currentCode: code });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorPendingSecret: null },
      }),
      this.prisma.backupCode.deleteMany({ where: { userId } }),
    ]);
  }

  /** Verify a TOTP code OR a one-time backup code for a user (login step-up). */
  async verifyCodeForUser(userId: string, code: string): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return false;
    }
    if (await this.verifyForUser(user, code)) {
      return true;
    }
    return this.consumeBackupCode(userId, code);
  }

  private async verifyForUser(user: User, code: string): Promise<boolean> {
    if (!user.twoFactorSecret) return false;

    // decrypt() throws on a GCM auth-tag mismatch, which is exactly what an
    // ENCRYPTION_KEY rotation produces for every previously-stored secret. Left
    // to propagate, it escapes verifyCodeForUser BEFORE the backup-code
    // fallback, so the one credential that could still get an administrator in
    // becomes unreachable and the platform is permanently unadministrable.
    // Returning false keeps that path open.
    let secret: string;
    try {
      secret = this.crypto.decrypt(user.twoFactorSecret);
    } catch {
      this.logger.error(
        `2FA secret for user ${user.id} could not be decrypted; falling back to backup codes. ` +
          'This usually means ENCRYPTION_KEY was rotated without re-encrypting stored secrets.',
      );
      return false;
    }
    return this.verifyToken(secret, code);
  }

  private verifyToken(secret: string, code: string): boolean {
    const token = (code ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(token)) return false;
    try {
      return authenticator.verify({ token, secret });
    } catch {
      return false;
    }
  }

  /** Atomically consume an unused backup code; returns true if one matched. */
  private async consumeBackupCode(userId: string, code: string): Promise<boolean> {
    const codeHash = this.crypto.sha256(this.crypto.normalizeBackupCode(code ?? ''));
    const match = await this.prisma.backupCode.findFirst({
      where: { userId, codeHash, usedAt: null },
    });
    if (!match) return false;
    const result = await this.prisma.backupCode.updateMany({
      where: { id: match.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return result.count === 1;
  }

  private async getUser(userId: string): Promise<User> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return user;
  }
}
