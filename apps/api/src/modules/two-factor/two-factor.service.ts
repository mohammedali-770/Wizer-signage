import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole, type User } from '@prisma/client';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';

import { CryptoService } from '../../common/crypto/crypto.service';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

/** True when 2FA must be enabled for this user (Super Admin or enforced). */
export function requiresTwoFactor(user: Pick<User, 'role' | 'twoFactorEnforced'>): boolean {
  return user.role === UserRole.SUPER_ADMIN || user.twoFactorEnforced;
}

@Injectable()
export class TwoFactorService {
  private readonly issuer: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    config: ConfigService,
  ) {
    this.issuer =
      config.get<AppConfig['twoFactor']>('twoFactor', { infer: true })?.issuer ?? 'MasterSignage';
    // Allow ±1 step (±30s) to tolerate clock drift.
    authenticator.options = { window: 1 };
  }

  /** Begin enrollment: generate + persist (encrypted) a pending TOTP secret. */
  async setup(userId: string): Promise<TwoFactorSetup> {
    const user = await this.getUser(userId);
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
  async enable(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const user = await this.getUser(userId);
    if (!user.twoFactorPendingSecret) {
      throw new BadRequestException('Start 2FA setup before enabling.');
    }
    const secret = this.crypto.decrypt(user.twoFactorPendingSecret);
    if (!this.verifyToken(secret, code)) {
      throw new UnauthorizedException('Invalid authentication code.');
    }

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
  async disable(userId: string, code: string): Promise<void> {
    const user = await this.getUser(userId);
    if (requiresTwoFactor(user)) {
      throw new ForbiddenException('Two-factor authentication is mandatory for this account.');
    }
    if (!user.twoFactorEnabled) {
      throw new BadRequestException('Two-factor authentication is not enabled.');
    }
    const ok =
      (await this.verifyForUser(user, code)) || (await this.consumeBackupCode(userId, code));
    if (!ok) {
      throw new UnauthorizedException('Invalid authentication code.');
    }

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
    const secret = this.crypto.decrypt(user.twoFactorSecret);
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
