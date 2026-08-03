import { randomUUID } from 'node:crypto';

import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';

import { CryptoService } from '../../common/crypto/crypto.service';
import type { AccessTokenPayload, AuthenticatedUser } from '../../common/types/auth.types';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { SessionsService } from '../sessions/sessions.service';
import { TwoFactorService } from '../two-factor/two-factor.service';
import type { StartImpersonationDto } from './dto/impersonation.dto';

/**
 * How long an impersonation lasts. Deliberately short and NOT renewable — see
 * the class comment. Support work is measured in minutes; anything that needs
 * longer needs a second, separately-audited decision to start it again.
 */
export const IMPERSONATION_TTL_MINUTES = 30;

/**
 * Audited super-admin impersonation.
 *
 * A Super Admin's principal carries `companyId = null`, so every
 * `@CurrentCompany` route answers 403. Helping a customer therefore meant
 * either an ad-hoc super-admin bypass inside a particular service or a direct
 * database edit — and neither records WHO acted in WHICH tenant, or WHY.
 *
 * Impersonation makes that an explicit, bounded, logged act:
 *
 *  - **Re-authentication.** A valid TOTP/backup code is required at the moment
 *    of the request. A session hijacked hours ago cannot silently pivot into
 *    every tenant on the platform.
 *  - **A stated reason.** Recorded on the session AND in both tenants' audit
 *    trails. "Why were you in my account" has an answer without a log dive.
 *  - **A separate session.** The admin's own session is untouched, so ending
 *    impersonation cannot log them out, and the impersonation appears in the
 *    session list where it can be revoked like anything else.
 *  - **No refresh token.** The session expires and is gone. There is no way to
 *    extend it, so a leaked impersonation token has a hard, short ceiling.
 */
@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);
  private readonly accessSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly twoFactor: TwoFactorService,
    private readonly activityLog: ActivityLogService,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessSecret = config.get<AppConfig['jwt']>('jwt', { infer: true })!.accessSecret;
  }

  async start(actor: AuthenticatedUser, dto: StartImpersonationDto, meta: RequestMeta) {
    if (!actor.isSuperAdmin) {
      throw new ForbiddenException('Only a Super Admin can impersonate.');
    }
    // Impersonating from inside an impersonation would let one hop obscure the
    // origin of the next; each must start from the admin's own session.
    if (actor.impersonatorId) {
      throw new BadRequestException('End the current impersonation before starting another.');
    }

    // Re-authenticate HERE, not "at some point during this session". This is
    // the whole point of the control: it binds the act to a person holding the
    // second factor right now.
    const verified = await this.twoFactor.verifyCodeForUser(actor.userId, dto.twoFactorCode);
    if (!verified) {
      await this.activityLog.log({
        action: 'superadmin.impersonation_denied',
        category: ActivityCategory.SECURITY,
        actorId: actor.userId,
        companyId: dto.companyId,
        metadata: { reason: 'invalid_two_factor_code' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new ForbiddenException('Two-factor verification failed.');
    }

    const company = await this.prisma.company.findFirst({
      where: { id: dto.companyId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!company) throw new BadRequestException('Company not found.');

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MINUTES * 60_000);
    const accessToken = await this.jwt.signAsync(
      {
        sub: actor.userId,
        sid: sessionId,
        role: UserRole.SUPER_ADMIN,
        cid: company.id,
        mfa: true,
        typ: 'access',
        imp: actor.userId,
      } satisfies AccessTokenPayload,
      { secret: this.accessSecret, expiresIn: `${IMPERSONATION_TTL_MINUTES}m` },
    );

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: actor.userId,
        companyId: company.id,
        impersonatorId: actor.userId,
        impersonationNote: dto.reason,
        // No refresh token exists for this session. A random, unmatchable value
        // is stored rather than a placeholder an attacker could guess or an
        // empty string that could collide with another row.
        refreshTokenHash: this.crypto.sha256(randomUUID()),
        expiresAt,
        mfaSatisfied: true,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });

    // Logged twice on purpose: once against the tenant, so the customer's own
    // audit view shows it, and once platform-wide for the security review.
    await this.activityLog.log({
      action: 'superadmin.impersonation_started',
      category: ActivityCategory.SECURITY,
      actorId: actor.userId,
      companyId: company.id,
      targetType: 'company',
      targetId: company.id,
      metadata: { reason: dto.reason, expiresAt: expiresAt.toISOString(), sessionId },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.activityLog.log({
      action: 'superadmin.impersonation_started',
      category: ActivityCategory.SECURITY,
      actorId: actor.userId,
      companyId: null,
      targetType: 'company',
      targetId: company.id,
      metadata: { reason: dto.reason, companyName: company.name, sessionId },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.logger.warn(
      `Impersonation started: admin=${actor.userId} company=${company.id} expires=${expiresAt.toISOString()}`,
    );

    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      company: { id: company.id, name: company.name },
      // No refreshToken: impersonation cannot be extended, only restarted.
    };
  }

  /** End the impersonation the caller is currently inside. */
  async end(actor: AuthenticatedUser, meta: RequestMeta) {
    if (!actor.impersonatorId) {
      throw new BadRequestException('Not currently impersonating.');
    }
    await this.sessions.revoke(actor.sessionId, 'impersonation_ended');
    await this.activityLog.log({
      action: 'superadmin.impersonation_ended',
      category: ActivityCategory.SECURITY,
      actorId: actor.impersonatorId,
      companyId: actor.companyId,
      targetType: 'company',
      targetId: actor.companyId ?? undefined,
      metadata: { sessionId: actor.sessionId },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { success: true as const };
  }

  /**
   * Every impersonation session that is live right now.
   *
   * "Who is inside a tenant at this moment" is the first question of any
   * security review, and without this it is unanswerable without a SQL client.
   */
  async listActive() {
    const rows = await this.prisma.session.findMany({
      where: { impersonatorId: { not: null }, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        impersonatorId: true,
        impersonationNote: true,
        companyId: true,
        createdAt: true,
        expiresAt: true,
        ip: true,
        company: { select: { name: true } },
        user: { select: { email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      sessionId: r.id,
      adminId: r.impersonatorId,
      adminEmail: r.user?.email ?? null,
      companyId: r.companyId,
      companyName: r.company?.name ?? null,
      reason: r.impersonationNote,
      startedAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      ip: r.ip,
    }));
  }
}

/** Request metadata captured by the `@ReqMeta()` decorator. */
interface RequestMeta {
  ip?: string;
  userAgent?: string;
}
