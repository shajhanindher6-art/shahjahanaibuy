/**
 * Changelog loading state (Section 19, item 95). Mirrors the
 * changelog page shape — heading + release-entry list.
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading changelog…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading changelog…</span>
      <main aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-8">
          <div className="space-y-3">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border p-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
