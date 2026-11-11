import { Skeleton } from '@/components/ui/skeleton';

/**
 * Tools hub loading state (Section 13, chunk H). Mirrors the
 * tools page shape — heading + tool card grid — using the same
 * Skeleton primitives as the search loading state
 * (app/search/loading.tsx). Applies to /tools and its child tool
 * pages. Decorative only: aria-hidden skeletons inside a
 * role="status" wrapper with a screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading tools…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading tools…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl text-center">
          <Skeleton className="mx-auto h-9 w-48" />
          <Skeleton className="mx-auto mt-3 h-4 w-96 max-w-full" />
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border p-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
