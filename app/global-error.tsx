'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html>
      <body>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: '0.75rem' }}>Application Error</h1>
          <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>Something went wrong. Please try again.</p>
          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '1rem' }}>Error ID: {error.digest}</p>
          )}
          <button
            onClick={reset}
            style={{ padding: '0.5rem 1.5rem', background: '#1e40af', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
