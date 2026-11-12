import { Skeleton } from '@/components/ui/skeleton';

/**
 * Products index loading state (Section 18, item 64 / audit §1 #79).
 * Mirrors the products listing shape — heading, filters, product
 * card grid — using the same Skeleton primitives as the other route
 * loading states. Decorative only: aria-hidden skeletons inside a
 * role="status" wrapper with a screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading products…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading products…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        <div className="mt-8 flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-full" />
          ))}
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border p-4">
              <Skeleton className="aspect-[4/3] w-full rounded-lg" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
