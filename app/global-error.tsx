'use client';

import { useEffect } from 'react';

/**
 * Global error boundary (Section 4 item 6). Renders its own
 * <html>/<body> because the root layout itself has failed, so no
 * Tailwind classes or shared components are available here — plain
 * inline styles only. Same three-part pattern as app/error.tsx:
 * what happened, why (kept generic — the real error is in the
 * console / Sentry), and the next step (try again, or go home).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);

    // Report to crash reporting service if configured — exactly
    // like app/error.tsx (Section 18, item 54). DSN-guarded and
    // never throws when Sentry is unconfigured or uninstalled:
    // with no NEXT_PUBLIC_SENTRY_DSN this is console-only.
    const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (sentryDsn && typeof window !== 'undefined') {
      // Use a string variable to prevent webpack from resolving at build time
      const sentryModule = '@sentry/nextjs';
      import(/* webpackIgnore: true */ sentryModule)
        .then((Sentry) => {
          Sentry.captureException(error);
        })
        .catch(() => {
          // Sentry not installed — console only
        });
    }
  }, [error]);

  return (
    <html>
      <body>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '1rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: '0.75rem' }}>Application Error</h1>
          <p style={{ color: '#64748b', marginBottom: '1.5rem', maxWidth: '28rem' }}>
            Something went wrong while loading the app. Please try again — if the
            problem continues, return home.
          </p>
          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '1rem' }}>Error ID: {error.digest}</p>
          )}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={reset}
              style={{ padding: '0.5rem 1.5rem', background: '#1e40af', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer' }}
            >
              Try Again
            </button>
            <button
              onClick={() => {
                window.location.href = '/';
              }}
              style={{ padding: '0.5rem 1.5rem', background: 'transparent', color: '#1e40af', border: '1px solid #cbd5e1', borderRadius: '0.5rem', cursor: 'pointer' }}
            >
              Go Home
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
