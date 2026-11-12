import { Skeleton } from '@/components/ui/skeleton';

/**
 * Refresh-runs loading state (Section 17, Stage F, item 27). Mirrors
 * the refresh-runs page shape — heading, note, summary card — using
 * the same Skeleton primitives as the other route loading states.
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading refresh runs…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading refresh runs…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-4xl">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          <Skeleton className="mt-4 h-20 w-full" />
          <Skeleton className="mt-6 h-24 w-full" />
          <Skeleton className="mt-4 h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
