import { Skeleton } from '@/components/ui/skeleton';

/**
 * Stores loading state (Section 15, A3). Mirrors the stores
 * page shape — heading + store card grid — using the same
 * Skeleton primitives as the brands loading state
 * (app/brands/loading.tsx). Decorative only: aria-hidden
 * skeletons inside a role="status" wrapper with a
 * screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading stores…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading stores…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-6xl">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>
        <div className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border p-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
