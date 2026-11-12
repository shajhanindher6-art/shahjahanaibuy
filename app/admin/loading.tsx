import { Skeleton } from '@/components/ui/skeleton';

/**
 * Admin loading state (Section 18, item 64 / audit §1 #79).
 * Mirrors the admin page shape — heading, text lines, table card —
 * using the same Skeleton primitives as the other route loading
 * states. Decorative only: aria-hidden skeletons inside a
 * role="status" wrapper with a screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading admin…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading admin…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-8">
        <div className="mx-auto max-w-4xl">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          <div className="mt-6 space-y-3 rounded-lg border p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
