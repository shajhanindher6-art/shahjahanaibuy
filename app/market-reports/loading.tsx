import { Skeleton } from '@/components/ui/skeleton';

/**
 * Market reports loading state (Section 13, chunk H). Mirrors the
 * market-reports page shape — heading + report rows — using the
 * same Skeleton primitives as the search loading state
 * (app/search/loading.tsx). Decorative only: aria-hidden skeletons
 * inside a role="status" wrapper with a screen-reader "Loading…"
 * label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading market reports…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading market reports…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl text-center">
          <Skeleton className="mx-auto h-9 w-64" />
          <Skeleton className="mx-auto mt-3 h-4 w-96 max-w-full" />
        </div>
        <div className="mx-auto mt-12 max-w-3xl space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-4">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
