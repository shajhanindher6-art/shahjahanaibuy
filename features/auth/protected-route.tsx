'use client';

/**
 * Protected route wrapper component.
 * Redirects unauthenticated users to the sign-in page.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-provider';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const redirect = new URLSearchParams(window.location.search).get('redirect');
      router.replace('/sign-in?redirect=' + encodeURIComponent(redirect ?? window.location.pathname));
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || (!isAuthenticated && !isLoading)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
