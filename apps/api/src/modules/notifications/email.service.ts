import { Injectable, Logger } from '@nestjs/common';
import { EmailDeliveryStatus, Prisma } from '@prisma/client';

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
 * EmailDeliveryLog (PENDING → SENT/FAILED). A failure is logged, never thrown —
 * email delivery must not break the originating action. In dev (no SMTP) the
 * underlying MailService logs the message; the row is still marked SENT so the
 * audit trail reflects what was dispatched.
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
