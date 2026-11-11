import { Skeleton } from '@/components/ui/skeleton';

/**
 * Events loading state (Section 13, chunk H). Mirrors the events
 * page shape — heading + event rows — using the same Skeleton
 * primitives as the search loading state (app/search/loading.tsx).
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading events…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading events…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl text-center">
          <Skeleton className="mx-auto h-9 w-48" />
          <Skeleton className="mx-auto mt-3 h-4 w-96 max-w-full" />
        </div>
        <div className="mx-auto mt-12 max-w-3xl space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4 rounded-lg border p-4">
              <Skeleton className="h-16 w-16 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
