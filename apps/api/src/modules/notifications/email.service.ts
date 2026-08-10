import { Injectable, Logger } from '@nestjs/common';
import { EmailDeliveryStatus, Prisma, UserStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

export interface SendEventInput {
  companyId: string | null;
  to: string;
  type?: string;
  subject: string;
  text: string;
  html?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Outbound email with an audit trail (Phase 10). Every send is recorded in
 * EmailDeliveryLog. Scheduled-report delivery has an additional hard boundary:
 * a report may only be mailed to an ACTIVE, non-deleted user in the owning
 * company. This is checked at SEND TIME so an old schedule cannot keep mailing
 * a departed employee or arbitrary external address after access changes.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async sendEvent(input: SendEventInput): Promise<{ ok: boolean; logId: string }> {
    const log = await this.prisma.emailDeliveryLog.create({
      data: {
        companyId: input.companyId,
        recipientEmail: input.to,
        subject: input.subject,
        type: input.type ?? null,
        status: EmailDeliveryStatus.PENDING,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    if (input.type === 'report') {
      const allowed = input.companyId
        ? await this.prisma.user.findFirst({
            where: {
              companyId: input.companyId,
              status: UserStatus.ACTIVE,
              deletedAt: null,
              email: { equals: input.to.trim(), mode: 'insensitive' },
            },
            select: { id: true },
          })
        : null;
      if (!allowed) {
        const error = 'Scheduled-report recipient is not an active user in the owning company.';
        this.logger.warn(`Blocked report email to ${input.to}: ${error}`);
        await this.prisma.emailDeliveryLog.update({
          where: { id: log.id },
          data: { status: EmailDeliveryStatus.FAILED, error },
        });
        return { ok: false, logId: log.id };
      }
    }

    try {
      const result = await this.mail.send({
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      await this.prisma.emailDeliveryLog.update({
        where: { id: log.id },
        data: {
          status: EmailDeliveryStatus.SENT,
          providerMessageId: result.messageId,
          sentAt: new Date(),
        },
      });
      return { ok: true, logId: log.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Email to ${input.to} failed (${input.type ?? 'generic'}): ${message}`);
      await this.prisma.emailDeliveryLog
        .update({
          where: { id: log.id },
          data: { status: EmailDeliveryStatus.FAILED, error: message },
        })
        .catch(() => undefined);
      return { ok: false, logId: log.id };
    }
  }

  /** True when a real SMTP transport is configured (vs. dev log-only). */
  get smtpConfigured(): boolean {
    return this.mail.isLive;
  }
}
