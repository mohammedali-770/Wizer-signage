import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User, UserStatus } from '@prisma/client';

import { CryptoService } from '../../common/crypto/crypto.service';
import { PasswordService } from '../../common/crypto/password.service';
import { hasPermission, Permission, ROLE_PERMISSIONS } from '../../common/rbac/permissions';
import type { AppConfig } from '../../config/configuration';
import type {
  AuthenticatedUser,
  RefreshTokenPayload,
  TwoFactorChallengePayload,
} from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { CompaniesService } from '../companies/companies.service';
import { InvitationsService } from '../invitations/invitations.service';
import { MailService } from '../mail/mail.service';
import { SessionsService } from '../sessions/sessions.service';
import { requiresTwoFactor, TwoFactorService } from '../two-factor/two-factor.service';
import { UsersService } from '../users/users.service';
import type {
  AcceptInvitationDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  TwoFactorLoginDto,
} from './dto/auth.dto';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Lifetime of a 2FA login step-up challenge (token expiry AND server record). */
const TWO_FACTOR_CHALLENGE_TTL_MS = 2 * 60 * 1000;

/**
 * Bound a free-text, potentially attacker-controlled value before persisting it.
 * Returns undefined for empty input so an absent header stays absent rather than
 * becoming an empty string.
 */
function truncate(value: string, max: number): string;
function truncate(value: string | undefined | null, max: number): string | undefined;
function truncate(value: string | undefined | null, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtl: string;
  private readonly refreshTtl: string;
  private readonly dashboardUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly companies: CompaniesService,
    private readonly twoFactor: TwoFactorService,
    private readonly invitations: InvitationsService,
    private readonly activityLog: ActivityLogService,
    private readonly mail: MailService,
    private readonly crypto: CryptoService,
    private readonly password: PasswordService,
    config: ConfigService,
  ) {
    const jwtConfig = config.get<AppConfig['jwt']>('jwt', { infer: true });
    this.accessSecret = jwtConfig?.accessSecret ?? '';
    this.refreshSecret = jwtConfig?.refreshSecret ?? '';
    this.accessTtl = jwtConfig?.accessTtl ?? '15m';
    this.refreshTtl = jwtConfig?.refreshTtl ?? '30d';
    this.dashboardUrl =
      config.get<AppConfig['app']>('app', { infer: true })?.dashboardUrl ?? 'http://localhost:3000';
  }

  // --- Login --------------------------------------------------------------

  async login(dto: LoginDto, meta: RequestMeta) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.users.findByEmail(email);

    if (!user || !user.passwordHash) {
      await this.recordLogin(email, null, false, 'invalid_credentials', meta);
      throw this.invalidCredentials();
    }
    // isBlocked covers BOTH the failed-login lockout and an indefinite
    // administrative lock (status LOCKED with no lockedUntil), which used to
    // pass straight through because only the timestamp was ever checked.
    if (this.users.isBlocked(user) && user.status !== UserStatus.DISABLED) {
      await this.recordLogin(email, user.id, false, 'locked', meta, true);
      throw this.lockedError();
    }
    if (user.status === UserStatus.DISABLED) {
      await this.recordLogin(email, user.id, false, 'disabled', meta);
      throw new ForbiddenException('This account has been disabled.');
    }

    const valid = await this.password.verify(user.passwordHash, dto.password);
    if (!valid) {
      const { locked } = await this.users.recordFailedLogin(user);
      await this.recordLogin(
        email,
        user.id,
        false,
        locked ? 'locked_now' : 'bad_password',
        meta,
        locked,
      );
      if (locked) throw this.lockedError();
      throw this.invalidCredentials();
    }

    await this.assertCompanyActive(user);

    // 2FA step-up: issue a short-lived challenge and DEFER both session creation
    // and the lockout-counter reset until the second factor is verified — so an
    // attacker who knows only the password cannot loop login to clear lockout.
    if (user.twoFactorEnabled) {
      // Persist a server-side challenge record so the challenge is genuinely
      // single-use (consumed on the first successful verification).
      const challenge = await this.prisma.twoFactorChallenge.create({
        data: {
          userId: user.id,
          expiresAt: new Date(Date.now() + TWO_FACTOR_CHALLENGE_TTL_MS),
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      const challengeToken = await this.jwt.signAsync(
        { sub: user.id, cid: challenge.id, typ: '2fa_challenge' },
        { secret: this.accessSecret, expiresIn: '2m' },
      );
      await this.recordLogin(email, user.id, true, '2fa_challenge', meta);
      return { requiresTwoFactor: true as const, challengeToken };
    }

    await this.users.recordSuccessfulLogin(user.id);
    const required = requiresTwoFactor(user);
    const tokens = await this.issueSession(user, !required, meta);
    await this.recordLogin(email, user.id, true, 'ok', meta);
    await this.activityLog.log({
      action: 'auth.login',
      category: ActivityCategory.AUTH,
      actorId: user.id,
      companyId: user.companyId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      ...tokens,
      user: this.users.toView(user),
      // Super Admin (or enforced user) without 2FA must enrol before full access.
      mustEnableTwoFactor: required,
    };
  }

  async verifyTwoFactorLogin(dto: TwoFactorLoginDto, meta: RequestMeta) {
    let payload: TwoFactorChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<TwoFactorChallengePayload>(dto.challengeToken, {
        secret: this.accessSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired two-factor challenge.');
    }
    if (payload.typ !== '2fa_challenge' || !payload.cid) {
      throw new UnauthorizedException('Invalid two-factor challenge.');
    }

    // Server-side single-use guard: the challenge must still exist, belong to
    // this user, be unconsumed, and be unexpired. A replayed (already consumed)
    // or expired challenge is rejected here even within the token lifetime.
    const challenge = await this.prisma.twoFactorChallenge.findFirst({
      where: {
        id: payload.cid,
        userId: payload.sub,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!challenge) {
      throw new UnauthorizedException('Invalid or expired two-factor challenge.');
    }

    const user = await this.users.findById(payload.sub);
    if (!user || this.users.isBlocked(user) || !user.twoFactorEnabled) {
      throw new UnauthorizedException('Invalid two-factor challenge.');
    }

    const ok = await this.twoFactor.verifyCodeForUser(user.id, dto.code);
    if (!ok) {
      // Count failed second-factor attempts toward the same lockout threshold.
      // The challenge is NOT consumed, so the user may retry within the window.
      const { locked } = await this.users.recordFailedLogin(user);
      await this.recordLogin(
        user.email,
        user.id,
        false,
        locked ? '2fa_locked' : '2fa_failed',
        meta,
        true,
      );
      if (locked) throw this.lockedError();
      throw new UnauthorizedException('Invalid authentication code.');
    }

    // Atomically consume the challenge — the gate that makes it single-use and
    // wins any race between concurrent valid submissions.
    const consumed = await this.prisma.twoFactorChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException('This two-factor challenge has already been used.');
    }

    await this.assertCompanyActive(user);
    await this.users.recordSuccessfulLogin(user.id);
    const tokens = await this.issueSession(user, true, meta);
    await this.recordLogin(user.email, user.id, true, '2fa_ok', meta);
    await this.activityLog.log({
      action: 'auth.login',
      category: ActivityCategory.AUTH,
      actorId: user.id,
      companyId: user.companyId,
      metadata: { method: 'two_factor' },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { ...tokens, user: this.users.toView(user) };
  }

  // --- Refresh / logout ---------------------------------------------------

  async refresh(refreshToken: string) {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('Invalid token type.');
    }

    // Validates revocation, expiry, and the inactivity window.
    const session = await this.sessions.validateForAccess(payload.sid);

    // Refresh-token reuse / mismatch detection: kill the session.
    //
    // With one exception. Rotation replaces the stored hash the instant this
    // endpoint succeeds, so a client that never RECEIVES the new token — a
    // dropped response, the app killed mid-request, two browser tabs refreshing
    // at the same moment — retries with the old one. Treating that as theft
    // logged the user out silently and recorded "refresh_reuse_detected" as
    // though they had been attacked. The immediately-previous token is therefore
    // accepted for REFRESH_GRACE_MS after rotation; anything older, or any token
    // more than one generation back, still destroys the session.
    const presented = this.crypto.sha256(refreshToken);
    if (!this.crypto.hashEquals(session.refreshTokenHash, presented)) {
      if (!this.sessions.isWithinRotationGrace(session, presented)) {
        await this.sessions.revoke(session.id, 'refresh_reuse_detected');
        throw new UnauthorizedException('Refresh token is no longer valid.');
      }
    }

    const user = await this.users.findById(session.userId);
    if (!user || this.users.isBlocked(user)) {
      await this.sessions.revoke(session.id, 'user_inactive');
      throw new UnauthorizedException('Account is no longer active.');
    }
    if (user.companyId) {
      const company = await this.companies.findById(user.companyId);
      if (!company || this.companies.isSuspended(company)) {
        await this.sessions.revoke(session.id, 'company_suspended');
        throw new UnauthorizedException('Company is suspended.');
      }
    }

    const newRefresh = await this.signRefresh(user.id, session.id);
    const newAccess = await this.signAccess(user, session.id, session.mfaSatisfied);
    await this.sessions.rotate(
      session.id,
      this.crypto.sha256(newRefresh),
      this.expiryOf(newRefresh),
      // Remember exactly one generation, so the retry that produced THIS call
      // can itself be retried, and nothing older ever can.
      session.refreshTokenHash,
    );

    return { accessToken: newAccess, refreshToken: newRefresh, user: this.users.toView(user) };
  }

  async logout(principal: AuthenticatedUser): Promise<{ success: true }> {
    await this.sessions.revoke(principal.sessionId, 'logout');
    await this.activityLog.log({
      action: 'auth.logout',
      category: ActivityCategory.AUTH,
      actorId: principal.userId,
      companyId: principal.companyId,
    });
    return { success: true };
  }

  // --- Password reset -----------------------------------------------------

  async forgotPassword(dto: ForgotPasswordDto, meta: RequestMeta): Promise<{ success: true }> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.users.findByEmail(email);

    // Only act for a real, usable account — but always return success so we do
    // not leak which emails exist.
    if (user && user.status !== UserStatus.DISABLED && user.passwordHash) {
      const rawToken = this.crypto.randomToken(32);
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.crypto.sha256(rawToken),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });
      const link = `${this.dashboardUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
      // Swallow transport failures: an SMTP outage must NOT turn this endpoint
      // into an account-enumeration oracle (a 500 for real accounts vs. 200 for
      // unknown ones tells an attacker which emails exist). The invitations flow
      // catches for the same reason. The reset row is already persisted, so the
      // user can retry once mail recovers.
      try {
        await this.mail.send({
          to: user.email,
          subject: 'Reset your Wizer Signage password',
          text:
            `We received a request to reset your password.\n\n` +
            `Reset it here (valid for 1 hour):\n${link}\n\n` +
            `If you did not request this, you can safely ignore this email.`,
        });
      } catch (error) {
        this.logger.error(
          `Password-reset email delivery failed for user ${user.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
      await this.activityLog.log({
        action: 'auth.password_reset_requested',
        category: ActivityCategory.SECURITY,
        actorId: user.id,
        companyId: user.companyId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    return { success: true };
  }

  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta): Promise<{ success: true }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.crypto.sha256(dto.token) },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This reset link is invalid or has expired.');
    }
    const user = await this.users.findById(record.userId);
    if (!user) {
      throw new BadRequestException('This reset link is invalid or has expired.');
    }

    await this.validateNewPassword(dto.password, user.id);
    const passwordHash = await this.password.hash(dto.password);
    await this.users.setPassword(user.id, passwordHash);
    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    // Invalidate any other outstanding reset tokens for this user.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    // Invalidate all sessions on password change.
    await this.sessions.revokeAllForUser(user.id, 'password_reset');
    await this.activityLog.log({
      action: 'auth.password_reset',
      category: ActivityCategory.SECURITY,
      actorId: user.id,
      companyId: user.companyId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { success: true };
  }

  // --- Invitation acceptance ---------------------------------------------

  async acceptInvitation(dto: AcceptInvitationDto): Promise<{ accepted: true; email: string }> {
    // Validate the password before consuming the token (a weak password must
    // not burn a single-use invite), then atomically consume it.
    await this.validateNewPassword(dto.password, null);
    const invitation = await this.invitations.consumeByToken(dto.token);
    const passwordHash = await this.password.hash(dto.password);

    const user = await this.users.createFromInvitation({
      email: invitation.email,
      name: dto.name,
      passwordHash,
      role: invitation.role,
      companyId: invitation.companyId,
      locationIds: invitation.locationIds,
    });

    await this.activityLog.log({
      action: 'user.created',
      category: ActivityCategory.USER,
      companyId: invitation.companyId,
      actorId: user.id,
      targetType: 'user',
      targetId: user.id,
      metadata: { via: 'invitation', role: invitation.role },
    });
    await this.activityLog.log({
      action: 'invitation.accepted',
      category: ActivityCategory.INVITATION,
      companyId: invitation.companyId,
      actorId: user.id,
      targetType: 'invitation',
      targetId: invitation.id,
    });

    return { accepted: true, email: user.email };
  }

  // --- Profile ------------------------------------------------------------

  async getMe(principal: AuthenticatedUser) {
    const user = await this.users.findById(principal.userId);
    if (!user) {
      throw new UnauthorizedException('Account not found.');
    }
    const permissions = principal.isSuperAdmin
      ? Object.values(Permission)
      : [...(ROLE_PERMISSIONS[user.role] ?? [])];

    return {
      user: this.users.toView(user),
      permissions,
      mfaSatisfied: principal.mfaSatisfied,
      twoFactorRequired: principal.twoFactorRequired,
    };
  }

  /** Exposed for guards/tests: does this principal hold a permission? */
  can(principal: Pick<AuthenticatedUser, 'role'>, permission: Permission): boolean {
    return hasPermission(principal.role, permission);
  }

  // --- Internals ----------------------------------------------------------

  private async issueSession(
    user: User,
    mfaSatisfied: boolean,
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const sessionId = randomUUID();
    const accessToken = await this.signAccess(user, sessionId, mfaSatisfied);
    const refreshToken = await this.signRefresh(user.id, sessionId);

    await this.sessions.create({
      id: sessionId,
      userId: user.id,
      companyId: user.companyId,
      refreshTokenHash: this.crypto.sha256(refreshToken),
      expiresAt: this.expiryOf(refreshToken),
      mfaSatisfied,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { accessToken, refreshToken };
  }

  private signAccess(user: User, sessionId: string, mfa: boolean): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, sid: sessionId, role: user.role, cid: user.companyId, mfa, typ: 'access' },
      { secret: this.accessSecret, expiresIn: this.accessTtl },
    );
  }

  private signRefresh(userId: string, sessionId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId, typ: 'refresh' },
      { secret: this.refreshSecret, expiresIn: this.refreshTtl },
    );
  }

  /** Read the `exp` claim of a freshly-signed token as a Date. */
  private expiryOf(token: string): Date {
    const decoded = this.jwt.decode(token) as { exp?: number } | null;
    const exp = decoded?.exp ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    return new Date(exp * 1000);
  }

  private async assertCompanyActive(user: User): Promise<void> {
    if (!user.companyId) return;
    const company = await this.companies.findById(user.companyId);
    if (!company || this.companies.isSuspended(company)) {
      throw new ForbiddenException('Your company account is suspended.');
    }
  }

  /** Policy + common-password + (when known) reuse checks. Throws on failure. */
  private async validateNewPassword(password: string, userId: string | null): Promise<void> {
    const result = this.password.evaluate(password);
    if (!result.valid) {
      throw new BadRequestException(result.errors.join(' '));
    }
    if (userId) {
      const recent = await this.users.getRecentPasswordHashes(userId, 3);
      for (const hash of recent) {
        if (await this.password.verify(hash, password)) {
          throw new BadRequestException('You cannot reuse a recent password. Choose a new one.');
        }
      }
    }
  }

  private async recordLogin(
    email: string,
    userId: string | null,
    success: boolean,
    reason: string,
    meta: RequestMeta,
    suspicious = false,
  ): Promise<void> {
    try {
      await this.prisma.loginEvent.create({
        data: {
          // email and userAgent are ATTACKER-CONTROLLED on a failed login and
          // were stored untruncated, so credential-stuffing traffic could write
          // unbounded bytes per attempt into a table with no retention path.
          // Retention now prunes this table; truncation bounds the per-row cost.
          email: truncate(email, 320), // RFC 5321 max addressable length
          userId: userId ?? undefined,
          success,
          reason,
          ip: meta.ip,
          userAgent: truncate(meta.userAgent, 512),
          suspicious,
        },
      });
    } catch {
      // Login auditing must never block authentication.
    }
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Invalid email or password.');
  }

  private lockedError(): HttpException {
    // 423 Locked (not present in Nest's HttpStatus enum).
    return new HttpException(
      {
        code: 'ACCOUNT_LOCKED',
        message: 'Account temporarily locked due to too many failed attempts. Try again later.',
      },
      423,
    );
  }
}
