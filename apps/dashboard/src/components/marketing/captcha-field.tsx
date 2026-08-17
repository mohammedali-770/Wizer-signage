'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * Human-verification widget for the public marketing forms.
 *
 * Provider-agnostic to match the API, which verifies against whichever of
 * Turnstile / reCAPTCHA / hCaptcha is configured server-side. The three expose
 * the same explicit-render surface — `render(el, {sitekey, callback})` plus a
 * `reset` — so one component covers all of them.
 *
 * DISABLED WHEN UNCONFIGURED. With no `NEXT_PUBLIC_CAPTCHA_SITE_KEY` the widget
 * renders nothing and reports a null token, which keeps local development
 * working without a provider account. That is safe ONLY because the server is
 * the thing that decides: production refuses to boot without a secret, and a
 * request with no token is refused there. A missing site key can cost a user a
 * confusing rejection, never a bypass.
 */

type Provider = 'turnstile' | 'recaptcha' | 'hcaptcha';

interface CaptchaApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | number;
  reset: (id?: string | number) => void;
}

const SITE_KEY = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY;
const PROVIDER = (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER as Provider) || 'turnstile';

const SCRIPT: Record<Provider, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  recaptcha: 'https://www.google.com/recaptcha/api.js?render=explicit',
  hcaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit',
};

/** Where each provider hangs its API on `window`. */
const GLOBAL: Record<Provider, string> = {
  turnstile: 'turnstile',
  recaptcha: 'grecaptcha',
  hcaptcha: 'hcaptcha',
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Both marketing forms can mount in one session; a second <script> would
    // re-register the global and orphan the first widget.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') resolve();
      else {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('captcha script failed')));
      }
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    });
    script.addEventListener('error', () => reject(new Error('captcha script failed')));
    document.head.appendChild(script);
  });
}

export interface CaptchaFieldHandle {
  reset: () => void;
}

export function CaptchaField({
  onToken,
  onResetRef,
}: {
  onToken: (token: string | null) => void;
  /** Lets the parent clear a spent token after a failed submit. */
  onResetRef?: (handle: CaptchaFieldHandle) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | number | null>(null);
  const [failed, setFailed] = useState(false);

  // The provider calls back from outside React, so the latest handler is held
  // in a ref rather than captured in the render that mounted the widget.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  const domId = useId().replace(/:/g, '');

  const reset = useCallback(() => {
    const api = (window as unknown as Record<string, CaptchaApi>)[GLOBAL[PROVIDER]];
    if (api && widgetIdRef.current !== null) api.reset(widgetIdRef.current);
    onTokenRef.current(null);
  }, []);

  useEffect(() => {
    onResetRef?.({ reset });
  }, [onResetRef, reset]);

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) return;
    let cancelled = false;

    loadScript(SCRIPT[PROVIDER])
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const api = (window as unknown as Record<string, CaptchaApi>)[GLOBAL[PROVIDER]];
        if (!api?.render) {
          setFailed(true);
          return;
        }
        // Guard against a double-mount (React 18 StrictMode runs effects twice
        // in development) rendering two widgets into the same node.
        if (widgetIdRef.current !== null) return;
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!SITE_KEY) return null;

  return (
    <div className="space-y-2">
      <div ref={containerRef} id={domId} />
      {failed && (
        <p className="text-sm text-red-600">
          The verification widget could not load. Disable any content blocker and reload.
        </p>
      )}
    </div>
  );
}
