import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import type { AppConfig } from '../../config/configuration';
import { ZeptoMailApiTransport } from './zeptomail-api.transport';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Email delivery.
 *
 * Three transports, chosen at boot:
 *
 * - `zeptomail-api` — ZeptoMail's REST endpoint over 443. Required on hosts
 *   that block outbound SMTP; DigitalOcean blocks 25/465/587 on every Droplet
 *   by default and ZeptoMail publishes no alternate submission port.
 * - `smtp` (default) — any SMTP provider, when SMTP_HOST and SMTP_PORT are set.
 * - dev fallback — a "json" transport that logs instead of sending, so
 *   invitation and password-reset flows work locally with no provider.
 *
 * Per-tenant branded senders (Company.brandedEmailFrom) are layered on in a
 * later phase.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter!: nodemailer.Transporter;
  private apiTransport?: ZeptoMailApiTransport;
  private fromAddress = 'Wizer Signage <no-reply@wizer.sa>';
  private liveTransport = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const smtp = this.config.get<AppConfig['smtp']>('smtp', { infer: true });
    const mail = this.config.get<AppConfig['mail']>('mail', { infer: true });
    if (smtp?.from) {
      this.fromAddress = smtp.from;
    }

    if (mail?.transport === 'zeptomail-api' && mail.zeptoMail?.apiKey) {
      this.apiTransport = new ZeptoMailApiTransport({
        apiKey: mail.zeptoMail.apiKey,
        endpoint: mail.zeptoMail.endpoint,
      });
      this.liveTransport = true;
      this.logger.log('Mail transport: ZeptoMail HTTPS API.');
      return;
    }

    if (mail?.transport === 'zeptomail-api') {
      // Selecting the API transport without a key is a deployment mistake, not
      // a request to fall back silently — that is exactly how this service ran
      // for months reporting healthy while delivering nothing.
      this.logger.error(
        'MAIL_TRANSPORT=zeptomail-api but ZEPTOMAIL_API_KEY is unset — falling back to SMTP/dev.',
      );
    }

    if (smtp?.host && smtp.port) {
      this.transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure ?? smtp.port === 465,
        auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
        // Bound every phase of the SMTP conversation. nodemailer's defaults are
        // ~10 minutes, so a degraded provider would hold a request (and its
        // pooled DB connection) open for that long — a slow mail host would take
        // the API down rather than just delaying mail.
        connectionTimeout: 5_000,
        greetingTimeout: 5_000,
        socketTimeout: 15_000,
        // Reuse connections instead of a fresh TCP+TLS handshake per message;
        // scheduled reports fan out to many recipients in a tight loop.
        pool: true,
        maxConnections: 3,
        maxMessages: 50,
      });
      this.liveTransport = true;
      this.logger.log(`Mail transport: SMTP (${smtp.host}:${smtp.port}).`);
      return;
    }

    // Dev fallback: does not send; returns the message as JSON.
    this.transporter = nodemailer.createTransport({ jsonTransport: true });
    this.logger.warn('SMTP not configured — emails are logged, not sent (dev mode).');
  }

  /**
   * Send an email. Returns the provider message id + whether a live transport
   * was used (the dev json transport does not actually deliver). Throws on a
   * transport error — callers that must not fail (alerts) should catch.
   */
  async send(message: MailMessage): Promise<{ messageId: string | null; live: boolean }> {
    if (this.apiTransport) {
      const { messageId } = await this.apiTransport.send({
        from: this.fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      this.logger.log(`Email sent to ${message.to} (id: ${messageId}).`);
      return { messageId, live: true };
    }

    const result = await this.transporter.sendMail({
      from: this.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    if (!this.liveTransport) {
      // SECURITY: never log the body. Password-reset and invitation emails carry
      // single-use bearer tokens in their links; logging the body writes them in
      // cleartext to `docker logs` and the host's json-file log on disk, where
      // anyone with host or log-shipper access can replay them to take over an
      // account (including a pending SUPER_ADMIN invite). Subject + recipient
      // are enough to confirm a dev flow fired.
      this.logger.debug(`[DEV EMAIL] to=${message.to} subject="${message.subject}"`);
    } else {
      this.logger.log(`Email sent to ${message.to} (id: ${result.messageId}).`);
    }
    return { messageId: result.messageId ?? null, live: this.liveTransport };
  }

  /** True when a real transport is configured (vs. the dev log-only mode). */
  get isLive(): boolean {
    return this.liveTransport;
  }
}
