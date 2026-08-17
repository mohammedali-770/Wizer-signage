import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CryptoService } from '../../common/crypto/crypto.service';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * Email confirmation for public trial signups.
 *
 * WHY: `POST /public/trial-signup` used to stamp `emailVerifiedAt` at creation,
 * so a tenant could be created under an address nobody controlled and it
 * started out trusted — a pre-verified COMPANY_ADMIN, one step from a password
 * reset on someone else's address.
 *
 * `emailVerifiedAt === null` now means exactly one thing: an unverified public
 * signup. Every other path that creates a user proves the address first —
 * `createFromInvitation` is reached by clicking an emailed link, and the seed
 * users are operator-created — and all of them set the timestamp. That is what
 * makes it safe for the login guard to key on null: no existing account has it.
 * A new user-creation path MUST either set `emailVerifiedAt` or issue a token
 * here, or its users will be unable to log in.
 */

/** Long enough that a stale link is useless, short enough to bound the window. */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private dashboardUrl(): string {
    return (
      this.config.get<AppConfig['app']>('app', { infer: true })?.dashboardUrl ??
      'http://localhost:3000'
    );
  }

  /**
   * Issue a fresh token and email the link.
   *
   * Any outstanding token for the user is consumed first, so requesting a new
   * link invalidates the old one — otherwise every resend would leave another
   * working key lying in another inbox.
   *
   * The send is awaited and allowed to throw. Unlike the welcome email, this one
   * IS the flow: silently failing would leave an account that can never log in
   * and no way for the user to find out why.
   */
  async issue(userId: string, email: string, name: string, locale: string): Promise<void> {
    const token = this.crypto.randomToken();
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.create({
        data: {
          userId,
          tokenHash: this.crypto.sha256(token),
          expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        },
      }),
    ]);

    const link = `${this.dashboardUrl()}/${locale}/verify-email?token=${encodeURIComponent(token)}`;
    const text =
      locale === 'ar'
        ? `مرحبًا ${name}،\n\nأكّد بريدك الإلكتروني لتفعيل حسابك في وايزر ساينج:\n${link}\n\nتنتهي صلاحية الرابط خلال 24 ساعة.\n`
        : `Hi ${name},\n\nConfirm your email address to activate your Wizer Signage account:\n${link}\n\nThis link expires in 24 hours.\n`;

    await this.mail.send({
      to: email,
      subject: locale === 'ar' ? 'أكّد بريدك الإلكتروني' : 'Confirm your email address',
      text,
    });
  }

  /**
   * Consume a token and mark the address verified.
   *
   * Idempotent for the user, not for the token: verifying an already-verified
   * account succeeds quietly rather than erroring, because a double-clicked link
   * is not a failure the user can act on. A consumed or expired token still
   * fails — that is the single-use property.
   */
  async confirm(rawToken: string): Promise<{ email: string }> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: this.crypto.sha256(rawToken) },
      include: { user: { select: { id: true, email: true, emailVerifiedAt: true } } },
    });

    if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
      // One message for every failure mode. Distinguishing "expired" from
      // "already used" from "never existed" tells a token-guesser which of
      // those they hit.
      throw new BadRequestException('This confirmation link is invalid or has expired.');
    }

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: record.user.emailVerifiedAt ?? new Date() },
      }),
    ]);

    this.logger.log(`Email verified for user ${record.userId}.`);
    return { email: record.user.email };
  }

  /**
   * Re-send the link for an unverified address.
   *
   * Always resolves the same way regardless of whether the address exists or is
   * already verified: this endpoint is unauthenticated, so a truthful answer
   * would turn it into an account-existence oracle. The caller returns a fixed
   * acknowledgement.
   */
  async resend(rawEmail: string): Promise<void> {
    const email = rawEmail.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, locale: true, emailVerifiedAt: true },
    });
    if (!user || user.emailVerifiedAt) return;

    try {
      await this.issue(user.id, user.email, user.name, user.locale ?? 'en');
    } catch (err) {
      // Swallowed on purpose: a mail failure here must not change the response,
      // or the timing/status difference reintroduces the oracle this method
      // exists to avoid.
      this.logger.warn(
        `Verification resend failed for user ${user.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
