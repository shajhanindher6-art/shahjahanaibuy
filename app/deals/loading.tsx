import { Skeleton } from '@/components/ui/skeleton';

/**
 * Deals loading state (Section 10, chunk 2). Mirrors the deals
 * page shape — category filters, deal cards — using the same
 * Skeleton primitives as the product page's Suspense fallback
 * (components/ui/skeleton.tsx). Decorative only: aria-hidden
 * skeletons inside a role="status" wrapper with a screen-reader
 * "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading deals…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading deals…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-6xl">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
          {/* Category filters */}
          <div className="mt-6 flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-full" />
            ))}
          </div>
          {/* Deal cards */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="space-y-3 rounded-lg border p-4">
                <Skeleton className="aspect-[4/3] w-full" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="h-9 w-24" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
