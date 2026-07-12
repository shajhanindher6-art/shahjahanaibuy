'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RefreshCw, Home, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);

    // Report to crash reporting service if configured
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 mb-6">
        <AlertTriangle className="h-8 w-8 text-destructive" />
      </div>
      <h1 className="text-3xl font-bold tracking-tight mb-3">Something went wrong</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        An unexpected error occurred. Our team has been notified. Please try again or return
        home.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground mb-4">Error ID: {error.digest}</p>
      )}
      <div className="flex gap-3">
        <Button onClick={reset} variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          Try Again
        </Button>
        <Button asChild>
          <Link href="/">
            <Home className="mr-2 h-4 w-4" />
            Go Home
          </Link>
        </Button>
      </div>
    </div>
  );
}
