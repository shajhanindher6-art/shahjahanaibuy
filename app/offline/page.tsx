'use client';

import Link from 'next/link';
import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 px-4 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800">
          <WifiOff className="h-10 w-10 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">You're Offline</h1>
          <p className="mt-2 text-muted-foreground">
            You appear to have lost your internet connection. Some features may be unavailable.
          </p>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => window.location.reload()} variant="outline">
            Try Again
          </Button>
          <Button asChild>
            <Link href="/">Go Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
