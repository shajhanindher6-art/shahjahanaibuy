import { Skeleton } from '@/components/ui/skeleton';

/**
 * Categories index loading state (Section 13, chunk H). Mirrors
 * the categories page shape — heading + category card grid —
 * using the same Skeleton primitives as the search loading state
 * (app/search/loading.tsx). Decorative only: aria-hidden skeletons
 * inside a role="status" wrapper with a screen-reader "Loading…"
 * label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading categories…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading categories…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl text-center">
          <Skeleton className="mx-auto h-9 w-56" />
          <Skeleton className="mx-auto mt-3 h-4 w-96 max-w-full" />
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
