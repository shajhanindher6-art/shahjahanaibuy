/**
 * Store page loading state (Section 19, item 95). Mirrors the
 * store page shape — store header + product rows.
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading store…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading store…</span>
      <main aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4 rounded-lg border p-4">
              <Skeleton className="h-20 w-20 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
