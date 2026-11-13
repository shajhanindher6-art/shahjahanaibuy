/**
 * Find hub loading state (Section 19, item 95). Mirrors the /find
 * index shape — heading + curated-query cards.
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading…</span>
      <main aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="space-y-3 text-center">
            <Skeleton className="mx-auto h-9 w-56" />
            <Skeleton className="mx-auto h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-12 w-full rounded-lg" />
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
