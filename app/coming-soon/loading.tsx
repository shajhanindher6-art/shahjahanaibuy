import { Skeleton } from '@/components/ui/skeleton';

/**
 * Coming-soon loading state (Section 13, chunk H). Mirrors the
 * roadmap page shape — heading + status-grouped feature rows —
 * using the same Skeleton primitives as the search loading state
 * (app/search/loading.tsx). Decorative only: aria-hidden skeletons
 * inside a role="status" wrapper with a screen-reader "Loading…"
 * label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading coming soon…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading coming soon…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl text-center">
          <Skeleton className="mx-auto h-9 w-56" />
          <Skeleton className="mx-auto mt-3 h-4 w-96 max-w-full" />
        </div>
        <div className="mx-auto mt-12 max-w-3xl space-y-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 rounded-lg border p-4">
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-full" />
              </div>
              <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
