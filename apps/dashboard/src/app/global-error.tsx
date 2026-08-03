'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary: catches errors thrown in the root layout itself, where
 * the ordinary route boundary cannot help because the layout that would render
 * it is the thing that failed.
 *
 * It therefore MUST render its own <html>/<body> — Next replaces the whole
 * document here — and must not import anything that could itself throw
 * (providers, i18n, fonts, the design system).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Fatal error:', error.message, error.digest ? `(digest ${error.digest})` : '');
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
          textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>The dashboard failed to load</h1>
        <p style={{ opacity: 0.75, maxWidth: '38rem' }}>
          Please reload the page. If this keeps happening, contact your administrator.
        </p>
        {error.digest ? (
          <code style={{ opacity: 0.6, fontSize: '0.8rem' }}>Reference: {error.digest}</code>
        ) : null}
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
          Reload
        </button>
      </body>
    </html>
  );
}
