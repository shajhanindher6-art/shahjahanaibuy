import { Skeleton } from '@/components/ui/skeleton';

/**
 * Extension page loading state (Section 13, chunk H). Mirrors the
 * extension guide shape — heading + info cards — using the same
 * Skeleton primitives as the search loading state
 * (app/search/loading.tsx). Decorative only: aria-hidden skeletons
 * inside a role="status" wrapper with a screen-reader "Loading…"
 * label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading extension…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading extension…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
        </div>
        <div className="mx-auto mt-8 max-w-2xl space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border p-4">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
