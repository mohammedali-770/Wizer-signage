'use client';

import { useEffect } from 'react';

/**
 * Route-level error boundary for everything under /[locale].
 *
 * There were previously NO error boundaries anywhere in the app (37 routes, 79
 * of 92 components client-side), so any render-time throw — a null field from
 * the API, a bad date, a failed fetch inside a client component — replaced the
 * whole page with Next's blank error screen and left the user with no way back
 * except the browser's back button.
 *
 * Deliberately dependency-free: no next-intl, no design-system imports, no data
 * fetching. An error boundary that relies on the same machinery as the page it
 * is catching for can fail for exactly the reason it was rendered, and Next then
 * escalates to the global boundary. Copy is bilingual rather than translated for
 * the same reason.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the browser console and in any error reporter wired later.
    // `digest` is the only safe server-side correlator Next exposes.
    console.error('Route error:', error.message, error.digest ? `(digest ${error.digest})` : '');
  }, [error]);

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Something went wrong</h1>
      <p style={{ opacity: 0.75, maxWidth: '38rem' }}>
        This page could not be displayed. The rest of the dashboard is still available.
      </p>
      <p style={{ opacity: 0.75, maxWidth: '38rem' }} dir="rtl" lang="ar">
        تعذّر عرض هذه الصفحة. بقية لوحة التحكم لا تزال متاحة.
      </p>

      {error.digest ? (
        <code style={{ opacity: 0.6, fontSize: '0.8rem' }}>Reference: {error.digest}</code>
      ) : null}

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
            border: '1px solid currentColor',
            cursor: 'pointer',
            background: 'transparent',
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
