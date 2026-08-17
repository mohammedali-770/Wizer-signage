import { Logger, ServiceUnavailableException } from '@nestjs/common';

import { CaptchaService } from './captcha.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The captcha guard on the unauthenticated signup surface.
 *
 * The behaviour that matters is what happens when things go WRONG. A captcha
 * that quietly passes on a provider outage, a missing secret, or an unparseable
 * response protects nothing exactly when it is needed — and `captchaToken` was
 * already accepted-and-ignored in this codebase once, which is how the field
 * came to advertise a control that did not exist. Every failure mode below is
 * asserted to REFUSE.
 */

function build(
  settings: Record<string, unknown> | undefined = {
    enabled: true,
    provider: 'turnstile',
    secret: 's3cret',
  },
) {
  const config = { get: jest.fn().mockReturnValue(settings) };
  return new CaptchaService(config as any);
}

const okResponse = (body: unknown) => ({ ok: true, json: async () => body });

describe('CaptchaService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('is a no-op when disabled, without calling the provider', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    const service = build({ enabled: false, provider: 'turnstile', secret: undefined });

    await expect(service.assertValid(undefined)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts a token the provider confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse({ success: true })) as any;
    await expect(build().assertValid('tok')).resolves.toBeUndefined();
  });

  it('sends the secret and token form-encoded, with the client IP', async () => {
    const fetchSpy = jest.fn().mockResolvedValue(okResponse({ success: true }));
    global.fetch = fetchSpy as any;

    await build().assertValid('tok', '203.0.113.7');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = init.body as URLSearchParams;
    expect(body.get('secret')).toBe('s3cret');
    expect(body.get('response')).toBe('tok');
    expect(body.get('remoteip')).toBe('203.0.113.7');
  });

  it.each([
    ['turnstile', 'https://challenges.cloudflare.com/turnstile/v0/siteverify'],
    ['recaptcha', 'https://www.google.com/recaptcha/api/siteverify'],
    ['hcaptcha', 'https://api.hcaptcha.com/siteverify'],
  ])('posts to the %s verify endpoint', async (provider, url) => {
    const fetchSpy = jest.fn().mockResolvedValue(okResponse({ success: true }));
    global.fetch = fetchSpy as any;

    await build({ enabled: true, provider, secret: 's' }).assertValid('tok');
    expect(fetchSpy.mock.calls[0][0]).toBe(url);
  });

  describe('refuses', () => {
    it('a missing token', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as any;
      await expect(build().assertValid(undefined)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(build().assertValid('   ')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('a token the provider rejects', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          okResponse({ success: false, 'error-codes': ['invalid-input-response'] }),
        ) as any;
      await expect(build().assertValid('tok')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('a provider HTTP error', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
      await expect(build().assertValid('tok')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('a provider timeout or network failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('AbortError')) as any;
      await expect(build().assertValid('tok')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('an unparseable provider response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('not json');
        },
      }) as any;
      await expect(build().assertValid('tok')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('enabled-but-unconfigured, rather than passing', async () => {
      // Production cannot boot into this state (env.validation.ts), but a
      // non-production process can, and passing would be silent.
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as any;
      const service = build({ enabled: true, provider: 'turnstile', secret: undefined });
      await expect(service.assertValid('tok')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('a reCAPTCHA v3 score below the threshold, even with success:true', async () => {
      global.fetch = jest.fn().mockResolvedValue(okResponse({ success: true, score: 0.1 })) as any;
      await expect(
        build({ enabled: true, provider: 'recaptcha', secret: 's' }).assertValid('tok'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  it('accepts a passing reCAPTCHA score', async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse({ success: true, score: 0.9 })) as any;
    await expect(
      build({ enabled: true, provider: 'recaptcha', secret: 's' }).assertValid('tok'),
    ).resolves.toBeUndefined();
  });

  it('never puts the secret in a log line', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error');
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    // A provider error whose message embeds the request body — the realistic way
    // a secret leaks into logs.
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('failed: secret=s3cret&response=tok')) as any;

    await expect(build().assertValid('tok')).rejects.toBeInstanceOf(ServiceUnavailableException);

    const logged = [...errorSpy.mock.calls, ...warnSpy.mock.calls].flat().join(' ');
    expect(logged).not.toContain('s3cret');
  });
});
