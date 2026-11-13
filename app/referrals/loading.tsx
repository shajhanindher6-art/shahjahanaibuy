/**
 * Referrals loading state (Section 19, item 95). Mirrors the
 * referrals page shape — heading + referral card + stats.
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading referrals…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading referrals…</span>
      <main aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <div className="space-y-3 rounded-lg border p-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-32 rounded-lg" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 rounded-lg border p-4">
                <Skeleton className="h-7 w-12" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
