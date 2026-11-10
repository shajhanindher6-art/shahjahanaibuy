'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Home, ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Friendly 404 (Section 4 item 6): what happened (this page does
 * not exist), why (it was moved, renamed, or the link was wrong),
 * and the next step (go back or go home). The old
 * `href="javascript:history.back()"` is gone — javascript: URLs
 * are blocked by the strict CSP and are bad practice; the back
 * button now uses the router.
 */
export default function NotFoundPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-6">
        <Sparkles className="h-8 w-8 text-primary" />
      </div>
      <div className="text-8xl font-bold text-muted-foreground/20 mb-4" aria-hidden="true">404</div>
      <h1 className="text-3xl font-bold tracking-tight mb-3">Page not found</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        The page you&apos;re looking for doesn&apos;t exist or has been moved. The
        link may be mistyped, or the page may have been renamed. Let&apos;s
        get you back on track.
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Go Back
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
