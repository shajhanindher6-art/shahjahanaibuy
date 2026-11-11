import { Skeleton } from '@/components/ui/skeleton';

/**
 * Pricing loading state (Section 13, chunk H). Mirrors the pricing
 * page shape — heading + four tier cards — using the same Skeleton
 * primitives as the search loading state (app/search/loading.tsx).
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading pricing…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading pricing…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl text-center">
          <Skeleton className="mx-auto h-9 w-64" />
          <Skeleton className="mx-auto mt-3 h-4 w-96 max-w-full" />
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border p-6">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-4 h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
