import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

/* eslint-disable @typescript-eslint/no-explicit-any */

const createTransport = nodemailer.createTransport as unknown as jest.Mock;

function buildService(over: { smtp?: any; mail?: any } = {}) {
  const config: any = {
    get: (key: string) => {
      if (key === 'smtp') return over.smtp ?? {};
      if (key === 'mail') return over.mail ?? { transport: 'smtp', zeptoMail: {} };
      return undefined;
    },
  };
  const service = new MailService(config);
  service.onModuleInit();
  return service;
}

const message = { to: 'operator@example.com', subject: 'Reset', text: 'link' };

describe('MailService transport selection', () => {
  let sendMail: jest.Mock;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    sendMail = jest.fn(() => Promise.resolve({ messageId: 'smtp-id' }));
    createTransport.mockReset();
    createTransport.mockReturnValue({ sendMail });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('uses SMTP when a host and port are configured', async () => {
    const service = buildService({ smtp: { host: 'smtp.example.com', port: 587, from: 'a@b.c' } });

    expect(service.isLive).toBe(true);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', port: 587 }),
    );
    await expect(service.send(message)).resolves.toEqual({ messageId: 'smtp-id', live: true });
  });

  it('falls back to the log-only json transport when nothing is configured', async () => {
    const service = buildService();

    expect(service.isLive).toBe(false);
    expect(createTransport).toHaveBeenCalledWith({ jsonTransport: true });
    await expect(service.send(message)).resolves.toEqual({ messageId: 'smtp-id', live: false });
  });

  describe('zeptomail-api transport', () => {
    const mail = { transport: 'zeptomail-api', zeptoMail: { apiKey: 'token-abc' } };

    it('selects the API transport and never builds an SMTP one', () => {
      const service = buildService({ smtp: { from: 'Wizer <no-reply@wizer.sa>' }, mail });

      expect(service.isLive).toBe(true);
      expect(createTransport).not.toHaveBeenCalled();
    });

    it('sends over HTTPS carrying the configured From address', async () => {
      const sent: RequestInit[] = [];
      globalThis.fetch = ((_url: unknown, init: unknown) => {
        sent.push(init as RequestInit);
        return Promise.resolve(
          new Response(JSON.stringify({ request_id: 'req-9' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }) as unknown as typeof fetch;

      const service = buildService({ smtp: { from: 'Wizer <no-reply@wizer.sa>' }, mail });
      const result = await service.send(message);

      expect(result).toEqual({ messageId: 'req-9', live: true });
      expect(sendMail).not.toHaveBeenCalled();
      const [request] = sent;
      if (!request) throw new Error('expected the API transport to call fetch, but it did not');
      const body = JSON.parse(String(request.body));
      expect(body.from).toEqual({ address: 'no-reply@wizer.sa', name: 'Wizer' });
      expect(body.to).toEqual([{ email_address: { address: 'operator@example.com' } }]);
    });

    // Selecting the API transport with no key is a deployment mistake. Silently
    // dropping to SMTP is how a mail path stays broken without anyone noticing,
    // so the fallback has to be loud.
    it('logs an error and falls back to SMTP when the API key is missing', () => {
      const logged: string[] = [];
      jest.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
        logged.push(String(args[0]));
      });

      const service = buildService({
        smtp: { host: 'smtp.example.com', port: 587 },
        mail: { transport: 'zeptomail-api', zeptoMail: {} },
      });

      expect(logged.join('\n')).toMatch(/ZEPTOMAIL_API_KEY is unset/);
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'smtp.example.com' }),
      );
      expect(service.isLive).toBe(true);
    });

    it('falls back to log-only when neither the API key nor SMTP is configured', () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      const service = buildService({ mail: { transport: 'zeptomail-api', zeptoMail: {} } });

      expect(service.isLive).toBe(false);
      expect(createTransport).toHaveBeenCalledWith({ jsonTransport: true });
    });
  });
});
