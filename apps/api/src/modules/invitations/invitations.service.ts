import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Invitation, InvitationStatus, Prisma, UserRole } from '@prisma/client';
import { DEFAULT_PAGE_SIZE, INVITE_EXPIRY_DAYS } from '@wizer/shared';

import { CryptoService } from '../../common/crypto/crypto.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { CompaniesService } from '../companies/companies.service';
import { MailService } from '../mail/mail.service';
import { UsageLimitsService } from '../usage-limits/usage-limits.service';
import type { CreateInvitationDto } from './dto/create-invitation.dto';
import type { ListInvitationsQueryDto } from './dto/list-invitations.dto';

export type InvitationView = Omit<Invitation, 'tokenHash'>;

/** Create/resend also return the raw token so the inviter can copy the accept
 *  link (works even when email delivery is not configured). */
export type InvitationCreatedView = InvitationView & { token: string };

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  private readonly dashboardUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
    private readonly companies: CompaniesService,
    private readonly activityLog: ActivityLogService,
    private readonly usageLimits: UsageLimitsService,
    config: ConfigService,
  ) {
    this.dashboardUrl =
      config.get<AppConfig['app']>('app', { infer: true })?.dashboardUrl ?? 'http://localhost:3000';
  }

  async create(actor: AuthenticatedUser, dto: CreateInvitationDto): Promise<InvitationCreatedView> {
    const email = dto.email.toLowerCase().trim();
    const companyId = await this.resolveTargetCompany(actor, dto);

    const existingUser = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists.');
    }

    // Location assignments must belong to the invitation's company (no cross-tenant ids).
    if (dto.locationIds && dto.locationIds.length > 0) {
      if (!companyId) {
        throw new BadRequestException(
          'Locations can only be assigned within a company-scoped invitation.',
        );
      }
      const valid = await this.prisma.location.findMany({
        where: { id: { in: dto.locationIds }, companyId, deletedAt: null },
        select: { id: true },
      });
      if (valid.length !== dto.locationIds.length) {
        throw new BadRequestException('One or more locations are invalid or not in this company.');
      }
    }

    // Enforce the company's plan user limit (allows during grace, blocks after).
    if (companyId) {
      await this.usageLimits.assertCanAdd(companyId, 'users');
    }

    // Supersede any prior pending invites for the same email in this scope.
    await this.prisma.invitation.updateMany({
      where: { email, companyId, status: InvitationStatus.PENDING },
      data: { status: InvitationStatus.REVOKED, revokedAt: new Date() },
    });

    const rawToken = this.crypto.randomToken(32);
    const invitation = await this.prisma.invitation.create({
      data: {
        email,
        role: dto.role,
        companyId,
        invitedById: actor.userId,
        tokenHash: this.crypto.sha256(rawToken),
        locationIds: dto.locationIds ?? [],
        expiresAt: new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    await this.sendInvitationEmail(email, rawToken, dto.name);
    await this.activityLog.log({
      action: 'invitation.created',
      category: ActivityCategory.INVITATION,
      companyId,
      targetType: 'invitation',
      targetId: invitation.id,
      metadata: { email, role: dto.role },
    });

    return { ...this.toView(invitation), token: rawToken };
  }

  async list(actor: AuthenticatedUser, query: ListInvitationsQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));

    const where: Prisma.InvitationWhereInput = {};
    if (!actor.isSuperAdmin) {
      where.companyId = actor.companyId;
    } else if (query.companyId) {
      where.companyId = query.companyId;
    }
    if (query.status) where.status = query.status;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.invitation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invitation.count({ where }),
    ]);

    return {
      items: items.map((i) => this.toView(i)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async revoke(actor: AuthenticatedUser, id: string): Promise<InvitationView> {
    const invitation = await this.getScopedOrThrow(actor, id);
    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException('Cannot revoke an accepted invitation.');
    }
    const updated = await this.prisma.invitation.update({
      where: { id },
      data: { status: InvitationStatus.REVOKED, revokedAt: new Date() },
    });
    await this.activityLog.log({
      action: 'invitation.revoked',
      category: ActivityCategory.INVITATION,
      companyId: invitation.companyId,
      targetType: 'invitation',
      targetId: id,
    });
    return this.toView(updated);
  }

  async resend(actor: AuthenticatedUser, id: string): Promise<InvitationCreatedView> {
    const invitation = await this.getScopedOrThrow(actor, id);
    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException('This invitation has already been accepted.');
    }
    const rawToken = this.crypto.randomToken(32);
    const updated = await this.prisma.invitation.update({
      where: { id },
      data: {
        tokenHash: this.crypto.sha256(rawToken),
        status: InvitationStatus.PENDING,
        revokedAt: null,
        expiresAt: new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    await this.sendInvitationEmail(invitation.email, rawToken);
    await this.activityLog.log({
      action: 'invitation.resent',
      category: ActivityCategory.INVITATION,
      companyId: invitation.companyId,
      targetType: 'invitation',
      targetId: id,
    });
    return { ...this.toView(updated), token: rawToken };
  }

  // --- Acceptance (used by AuthService) ----------------------------------

  /** Resolve + validate an invitation by its raw token (throws otherwise). */
  async findValidByToken(rawToken: string): Promise<Invitation> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: this.crypto.sha256(rawToken) },
    });
    if (!invitation || invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('This invitation is invalid or has already been used.');
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new BadRequestException('This invitation has expired.');
    }
    return invitation;
  }

  async markAccepted(id: string): Promise<void> {
    await this.prisma.invitation.update({
      where: { id },
      data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
    });
  }

  /**
   * Atomically consume an invitation by its raw token so it is genuinely
   * single-use even under concurrent acceptance. Marks the invitation ACCEPTED
   * in one guarded write; a second caller for the same token gets a 400.
   */
  async consumeByToken(rawToken: string): Promise<Invitation> {
    const invitation = await this.findValidByToken(rawToken);
    // Re-check the user limit at acceptance. The pending invite already reserves
    // a seat (increment 0); this rejects acceptance once the grace period has
    // elapsed, closing the "accept after grace expiry" bypass.
    if (invitation.companyId) {
      await this.usageLimits.assertCanAdd(invitation.companyId, 'users', 0);
    }
    const result = await this.prisma.invitation.updateMany({
      where: { id: invitation.id, status: InvitationStatus.PENDING },
      data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
    });
    if (result.count !== 1) {
      throw new BadRequestException('This invitation has already been used.');
    }
    return invitation;
  }

  // --- Internals ----------------------------------------------------------

  private async resolveTargetCompany(
    actor: AuthenticatedUser,
    dto: CreateInvitationDto,
  ): Promise<string | null> {
    if (dto.role === UserRole.SUPER_ADMIN) {
      if (!actor.isSuperAdmin) {
        throw new ForbiddenException('Only a Super Admin can invite a Super Admin.');
      }
      return null; // platform-level
    }
    if (actor.isSuperAdmin) {
      if (!dto.companyId) {
        throw new BadRequestException('companyId is required when inviting into a company.');
      }
      await this.companies.getByIdOrThrow(dto.companyId);
      return dto.companyId;
    }
    // Company-scoped inviter.
    if (!actor.companyId) {
      throw new ForbiddenException('No company context for this invitation.');
    }
    return actor.companyId;
  }

  private async getScopedOrThrow(actor: AuthenticatedUser, id: string): Promise<Invitation> {
    const invitation = await this.prisma.invitation.findUnique({ where: { id } });
    if (!invitation || (!actor.isSuperAdmin && invitation.companyId !== actor.companyId)) {
      throw new NotFoundException('Invitation not found.');
    }
    return invitation;
  }

  private async sendInvitationEmail(email: string, rawToken: string, name?: string): Promise<void> {
    const link = `${this.dashboardUrl}/accept-invitation?token=${encodeURIComponent(rawToken)}`;
    // Best-effort: a transport error (e.g. SMTP not configured) must NOT fail the
    // invitation. The inviter always gets a copy-link from the create/resend
    // response, so delivery is non-critical.
    try {
      await this.mail.send({
        to: email,
        subject: 'You have been invited to Wizer Signage',
        text:
          `${name ? `Hi ${name},\n\n` : ''}You have been invited to join Wizer Signage.\n\n` +
          `Accept your invitation (valid for ${INVITE_EXPIRY_DAYS} days):\n${link}\n\n` +
          `If you did not expect this invitation, you can ignore this email.`,
      });
    } catch (err) {
      this.logger.warn(
        `Invitation email to ${email} failed (continuing — the inviter can copy the link): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  toView(invitation: Invitation): InvitationView {
    const { tokenHash: _omit, ...view } = invitation;
    return view;
  }
}
