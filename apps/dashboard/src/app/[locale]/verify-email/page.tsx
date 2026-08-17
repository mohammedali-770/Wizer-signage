'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { api, ApiError } from '@/lib/api';

/**
 * Landing page for the confirmation link emailed after a public trial signup.
 *
 * The token is consumed by a POST from the browser rather than by a GET on the
 * link itself. Mail clients, link scanners and corporate security gateways
 * pre-fetch URLs, and a single-use GET would be burned before the recipient
 * ever clicked — they would arrive to "this link is invalid" with no way back
 * except a resend that the scanner would also burn.
 */
export default function VerifyEmailPage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';
  const search = useSearchParams();
  const router = useRouter();
  const token = search.get('token');

  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  // React 18 StrictMode double-invokes effects in development; without this the
  // second run consumes the token the first one just spent and shows a failure.
  const startedRef = useRef(false);

  useEffect(() => {
    if (!token || startedRef.current) return;
    startedRef.current = true;
    setState('working');
    api
      .post('/auth/email/confirm', { token })
      .then(() => {
        setState('done');
        setTimeout(() => router.push(`/${locale}/login`), 2500);
      })
      .catch((err: unknown) => {
        setState('error');
        setMessage(
          err instanceof ApiError ? err.message : 'This confirmation link is invalid or expired.',
        );
      });
  }, [token, locale, router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      {!token && (
        <>
          <h1 className="text-xl font-semibold">Confirmation link incomplete</h1>
          <p className="text-muted-foreground text-sm">
            Open the link from your email exactly as it was sent.
          </p>
        </>
      )}

      {token && state === 'working' && <p className="text-sm">Confirming your email…</p>}

      {state === 'done' && (
        <>
          <h1 className="text-xl font-semibold">Email confirmed</h1>
          <p className="text-muted-foreground text-sm">Taking you to sign in…</p>
          <Link className="text-primary text-sm underline" href={`/${locale}/login`}>
            Sign in now
          </Link>
        </>
      )}

      {state === 'error' && (
        <>
          <h1 className="text-xl font-semibold">Could not confirm your email</h1>
          <p className="text-muted-foreground text-sm">{message}</p>
          <Link className="text-primary text-sm underline" href={`/${locale}/verify-email/sent`}>
            Request a new link
          </Link>
        </>
      )}
    </main>
  );
}
