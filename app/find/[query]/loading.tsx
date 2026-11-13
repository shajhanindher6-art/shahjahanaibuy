/**
 * Find-results loading state (Section 19, item 95 — highest
 * priority: this segment does a data fetch). Mirrors the results
 * shape — query heading + result rows.
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading results…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading results…</span>
      <main aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl space-y-6">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-4 w-96 max-w-full" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-4 rounded-lg border p-4">
              <Skeleton className="h-24 w-24 shrink-0 rounded-lg" />
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
