/**
 * Press loading state (Section 19, item 95). Mirrors the press
 * page shape — heading + stat blocks + coverage cards.
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading press…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading press…</span>
      <main aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-8">
          <div className="space-y-3 text-center">
            <Skeleton className="mx-auto h-9 w-56" />
            <Skeleton className="mx-auto h-4 w-96 max-w-full" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 rounded-lg border p-4">
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border p-4">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
