'use client';

/**
 * Protected route wrapper component.
 * Redirects unauthenticated users to the sign-in page.
 * Uses a local "initializing" guard to avoid redirecting before the
 * auth state has been confirmed on first mount.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-provider';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [initialized, setInitialized] = useState(false);
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    setInitialized(true);
  }, [isLoading]);

  useEffect(() => {
    if (!initialized || redirectedRef.current) return;
    if (!isAuthenticated) {
      redirectedRef.current = true;
      const redirect = new URLSearchParams(window.location.search).get('redirect');
      router.replace(
        '/sign-in?redirect=' + encodeURIComponent(redirect ?? window.location.pathname)
      );
    }
  }, [initialized, isAuthenticated, router]);

  if (!initialized || isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return <>{children}</>;
}
