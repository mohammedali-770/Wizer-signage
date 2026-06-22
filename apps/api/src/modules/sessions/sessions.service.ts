import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Session } from '@prisma/client';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';

/** Public-safe session view (never exposes the refresh-token hash). */
export type SessionView = Omit<Session, 'refreshTokenHash'> & { current?: boolean };

export interface CreateSessionInput {
  /** Optional explicit id so tokens can embed the session id before persistence. */
  id?: string;
  userId: string;
  companyId: string | null;
  refreshTokenHash: string;
  expiresAt: Date;
  mfaSatisfied: boolean;
  ip?: string;
  userAgent?: string;
}

/** Only refresh lastActiveAt at most once per this many ms (write throttling). */
const TOUCH_THROTTLE_MS = 30_000;

@Injectable()
export class SessionsService {
  private readonly inactivityMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const jwt = config.get<AppConfig['jwt']>('jwt', { infer: true });
    this.inactivityMs = (jwt?.sessionInactivityTimeoutMinutes ?? 30) * 60_000;
  }

  create(input: CreateSessionInput): Promise<Session> {
    return this.prisma.session.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        userId: input.userId,
        companyId: input.companyId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        mfaSatisfied: input.mfaSatisfied,
        ip: input.ip,
        userAgent: input.userAgent,
        lastActiveAt: new Date(),
      },
    });
  }

  /** Rotate the refresh token hash (and extend expiry) on refresh. */
  rotate(sessionId: string, refreshTokenHash: string, expiresAt: Date): Promise<Session> {
    return this.prisma.session.update({
      where: { id: sessionId },
      data: { refreshTokenHash, expiresAt, lastActiveAt: new Date() },
    });
  }

  findById(sessionId: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { id: sessionId } });
  }

  /**
   * Validates a session for an access-token request: must exist, not be
   * revoked, not be expired, and be within the inactivity window. On success
   * `lastActiveAt` is advanced (throttled). Throws otherwise.
   */
  async validateForAccess(sessionId: string): Promise<Session> {
    const session = await this.findById(sessionId);
    const now = Date.now();

    if (!session || session.revokedAt) {
      throw new UnauthorizedException('Session is no longer valid.');
    }
    if (session.expiresAt.getTime() <= now) {
      await this.revoke(session.id, 'expired');
      throw new UnauthorizedException('Session has expired.');
    }
    if (now - session.lastActiveAt.getTime() > this.inactivityMs) {
      await this.revoke(session.id, 'inactivity');
      throw new UnauthorizedException('Session expired due to inactivity.');
    }

    if (now - session.lastActiveAt.getTime() > TOUCH_THROTTLE_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastActiveAt: new Date() },
      });
    }
    return session;
  }

  /** Find an active session by refresh-token hash (for refresh-token rotation). */
  async findActiveByRefreshHash(refreshTokenHash: string): Promise<Session | null> {
    return this.prisma.session.findFirst({
      where: { refreshTokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  async markMfaSatisfied(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { mfaSatisfied: true },
    });
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Revoke every active session belonging to a company (e.g. on suspension). */
  async revokeAllForCompany(companyId: string, reason: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { companyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  /** Revoke all of a user's active sessions, optionally keeping one. */
  async revokeAllForUser(
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  async listActiveForUser(userId: string, currentSessionId?: string): Promise<SessionView[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: 'desc' },
    });
    return sessions.map((session) => this.toView(session, currentSessionId));
  }

  /** Revoke a single session that must belong to `userId` (404 otherwise). */
  async revokeOwn(userId: string, sessionId: string): Promise<void> {
    const session = await this.findById(sessionId);
    if (!session || session.userId !== userId || session.revokedAt) {
      throw new NotFoundException('Session not found.');
    }
    await this.revoke(sessionId, 'user_revoked');
  }

  /**
   * Admin action: terminate all sessions of a target user. The target must be
   * in the actor's company unless the actor is a Super Admin (cross-tenant).
   */
  async terminateUserSessions(
    actor: { companyId: string | null; isSuperAdmin: boolean },
    targetUserId: string,
  ): Promise<number> {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: { id: true, companyId: true },
    });
    if (!target || (!actor.isSuperAdmin && target.companyId !== actor.companyId)) {
      throw new NotFoundException('User not found.');
    }
    return this.revokeAllForUser(targetUserId, 'admin_terminated');
  }

  toView(session: Session, currentSessionId?: string): SessionView {
    const { refreshTokenHash: _omit, ...view } = session;
    return { ...view, current: session.id === currentSessionId };
  }
}
