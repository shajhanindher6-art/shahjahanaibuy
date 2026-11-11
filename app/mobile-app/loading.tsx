import { Skeleton } from '@/components/ui/skeleton';

/**
 * Mobile app loading state (Section 13, chunk H). Mirrors the
 * mobile-app page shape — hero + feature rows — using the same
 * Skeleton primitives as the search loading state
 * (app/search/loading.tsx). Decorative only: aria-hidden skeletons
 * inside a role="status" wrapper with a screen-reader "Loading…"
 * label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading mobile app…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading mobile app…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl text-center">
          <Skeleton className="mx-auto h-9 w-64" />
          <Skeleton className="mx-auto mt-3 h-4 w-96 max-w-full" />
          <Skeleton className="mx-auto mt-6 h-10 w-40" />
        </div>
        <div className="mx-auto mt-12 max-w-3xl space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 rounded-lg border p-4">
              <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
