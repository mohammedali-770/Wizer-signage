import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration';

/**
 * Human-verification for the unauthenticated public endpoints.
 *
 * WHY THIS EXISTS: `POST /public/trial-signup` creates a company, an owner and a
 * subscription with no authentication. Before this it was protected only by a
 * 5/hour/IP throttle, which a rotating-IP script walks straight through — and
 * every attempt writes tenant rows. The DTOs have accepted a `captchaToken`
 * since the beginning and nothing ever verified it, so the field advertised a
 * control that did not exist.
 *
 * PROVIDER-AGNOSTIC BY DESIGN. Turnstile, reCAPTCHA and hCaptcha all expose the
 * same shape: POST form-encoded `secret` + `response` (+ optional `remoteip`),
 * receive `{ success: boolean, ... }`. Supporting all three costs one URL table
 * and lets the provider be chosen at deploy time instead of in code.
 *
 * reCAPTCHA v3 additionally returns a `score` (0.0 bot … 1.0 human). It is
 * enforced when present; the others omit it and are judged on `success` alone.
 */

export type CaptchaProvider = 'turnstile' | 'recaptcha' | 'hcaptcha';

const VERIFY_URL: Record<CaptchaProvider, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
};

/** reCAPTCHA v3 only. Google's own documented starting point. */
const MIN_RECAPTCHA_SCORE = 0.5;

/**
 * The provider is a third party on the request path of a public endpoint, so a
 * slow one must not hold a connection open indefinitely.
 */
const VERIFY_TIMEOUT_MS = 5_000;

interface SiteVerifyResponse {
  success?: boolean;
  score?: number;
  'error-codes'?: string[];
}

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(private readonly config: ConfigService) {}

  private get settings(): AppConfig['captcha'] {
    return this.config.get<AppConfig['captcha']>('captcha', { infer: true })!;
  }

  /** True when a token is required. Lets callers describe the field honestly. */
  get enabled(): boolean {
    return this.settings.enabled;
  }

  /**
   * Verify a captcha token, or throw.
   *
   * DELIBERATELY FAIL-CLOSED. If the provider is unreachable, times out, or
   * answers with anything but a clean success, the request is refused. Treating
   * an outage as a pass would mean the protection disappears exactly when
   * someone is hammering the endpoint hard enough to matter — and the failure
   * would be invisible, which is how `captchaToken` came to be accepted and
   * ignored in the first place.
   *
   * A 503 (not 400) is used for provider failures so a legitimate user sees
   * "try again" rather than "you are a robot", and so it is distinguishable in
   * logs from a genuine rejection.
   */
  async assertValid(token: string | undefined, remoteIp?: string | null): Promise<void> {
    if (!this.enabled) return;

    if (!token || token.trim() === '') {
      throw new ServiceUnavailableException('Captcha verification is required.');
    }

    const { provider, secret } = this.settings;
    // Unreachable in production — env validation refuses to boot without a
    // secret when captcha is enabled — but a non-production process could get
    // here, and silently passing would be the exact bug this class exists for.
    if (!secret) {
      throw new ServiceUnavailableException('Captcha is enabled but not configured.');
    }

    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    let payload: SiteVerifyResponse;
    try {
      const res = await fetch(VERIFY_URL[provider], {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Status only. A provider body can echo the token back and the token is
        // a bearer-ish credential for that one attempt.
        this.logger.error(`Captcha provider ${provider} returned HTTP ${res.status}.`);
        throw new ServiceUnavailableException('Captcha verification is unavailable.');
      }
      payload = (await res.json()) as SiteVerifyResponse;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      // Never interpolate the caught error: an AbortError message is safe, but a
      // provider error can carry the request body, which contains the secret.
      this.logger.error(`Captcha provider ${provider} did not respond.`);
      throw new ServiceUnavailableException('Captcha verification is unavailable.');
    }

    if (payload.success !== true) {
      // error-codes are provider-defined and contain no user data; they are the
      // only way to tell a bad token from a bad SECRET, which otherwise look
      // identical from the outside and would be a miserable thing to debug.
      const codes = (payload['error-codes'] ?? []).join(', ');
      this.logger.warn(`Captcha rejected by ${provider}${codes ? ` (${codes})` : ''}.`);
      throw new ServiceUnavailableException('Captcha verification failed. Please try again.');
    }

    if (typeof payload.score === 'number' && payload.score < MIN_RECAPTCHA_SCORE) {
      this.logger.warn(
        `Captcha score ${payload.score} below ${MIN_RECAPTCHA_SCORE} (${provider}).`,
      );
      throw new ServiceUnavailableException('Captcha verification failed. Please try again.');
    }
  }
}
