import { Skeleton } from '@/components/ui/skeleton';

/**
 * Search loading state (Section 10, chunk 2). Mirrors the search
 * page shape — search bar, filter pills, result rows — using the
 * same Skeleton primitives as the product page's Suspense fallback
 * (components/ui/skeleton.tsx). Decorative only: aria-hidden
 * skeletons inside a role="status" wrapper with a screen-reader
 * "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading search…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading search…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-4xl">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
          {/* Search bar */}
          <Skeleton className="mt-6 h-12 w-full" />
          {/* Filter pills */}
          <div className="mt-4 flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-full" />
            ))}
          </div>
          {/* Result rows */}
          <div className="mt-8 space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-4 rounded-lg border p-4">
                <Skeleton className="h-24 w-24 shrink-0" />
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-full" />
                  <div className="flex gap-2">
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-6 w-20" />
                  </div>
                </div>
                <Skeleton className="h-8 w-20 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
