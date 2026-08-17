'use client';

import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import { api } from '@/lib/api';

/**
 * Shown straight after a trial signup, and reachable from a failed confirmation.
 *
 * The resend result is deliberately uninformative: the API answers identically
 * for an unknown address, an already-verified one and a real unverified one, so
 * this page must not imply otherwise. Saying "if that address needs confirming,
 * a link is on its way" keeps the UI honest about what the server actually
 * promises — anything more specific would turn the page into the account
 * enumeration oracle the endpoint was written to avoid.
 */
export default function VerificationSentPage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function resend(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      await api.post('/auth/email/resend', { email: email.trim() });
    } catch {
      // Swallowed on purpose. A visible difference between success and failure
      // would leak exactly what the endpoint refuses to disclose. The throttle
      // (3/hour) is the only thing a caller should be able to notice.
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div className="space-y-2 text-center">
        <h1 className="text-xl font-semibold">Confirm your email</h1>
        <p className="text-muted-foreground text-sm">
          We sent you a confirmation link. Follow it to activate your account — you cannot sign in
          until you do.
        </p>
      </div>

      {sent ? (
        <p className="text-center text-sm">
          If that address still needs confirming, a new link is on its way.
        </p>
      ) : (
        <form onSubmit={resend} className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="resend-email">
            Didn&apos;t get it? Send another
          </label>
          <input
            id="resend-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-border bg-background h-10 w-full rounded-md border px-3 text-sm"
            placeholder="you@company.com"
          />
          <button
            type="submit"
            disabled={busy}
            className="bg-primary text-primary-foreground h-10 w-full rounded-md text-sm disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Resend link'}
          </button>
        </form>
      )}

      <Link className="text-primary text-center text-sm underline" href={`/${locale}/login`}>
        Back to sign in
      </Link>
    </main>
  );
}
