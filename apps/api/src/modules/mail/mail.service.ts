import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import type { AppConfig } from '../../config/configuration';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Email delivery.
 *
 * When SMTP_* is configured a real SMTP transport is used; otherwise a
 * development "json" transport logs the message so flows (invitations, password
 * reset) work locally without an email provider. Per-tenant branded senders
 * (Company.brandedEmailFrom) are layered on in a later phase.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter!: nodemailer.Transporter;
  private fromAddress = 'MasterSignage <no-reply@mastersignage.local>';
  private liveTransport = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const smtp = this.config.get<AppConfig['smtp']>('smtp', { infer: true });
    if (smtp?.from) {
      this.fromAddress = smtp.from;
    }

    if (smtp?.host && smtp.port) {
      this.transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure ?? smtp.port === 465,
        auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
      });
      this.liveTransport = true;
      this.logger.log(`SMTP transport configured (${smtp.host}:${smtp.port}).`);
    } else {
      // Dev fallback: does not send; returns the message as JSON.
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      this.logger.warn('SMTP not configured — emails are logged, not sent (dev mode).');
    }
  }

  /**
   * Send an email. Returns the provider message id + whether a live transport
   * was used (the dev json transport does not actually deliver). Throws on a
   * transport error — callers that must not fail (alerts) should catch.
   */
  async send(message: MailMessage): Promise<{ messageId: string | null; live: boolean }> {
    const result = await this.transporter.sendMail({
      from: this.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    if (!this.liveTransport) {
      this.logger.debug(`[DEV EMAIL] to=${message.to} subject="${message.subject}"`);
      this.logger.debug(`[DEV EMAIL] body:\n${message.text}`);
    } else {
      this.logger.log(`Email sent to ${message.to} (id: ${result.messageId}).`);
    }
    return { messageId: result.messageId ?? null, live: this.liveTransport };
  }

  /** True when a real SMTP transport is configured (vs. the dev log-only mode). */
  get isLive(): boolean {
    return this.liveTransport;
  }
}
