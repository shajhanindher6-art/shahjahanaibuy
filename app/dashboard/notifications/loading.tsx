import { Skeleton } from '@/components/ui/skeleton';

/**
 * Notifications loading state (Section 18, item 64 / audit §1 #79).
 * Mirrors the dashboard sub-page shape — heading, text lines, list
 * card — using the same Skeleton primitives as the other route
 * loading states. Decorative only: aria-hidden skeletons inside a
 * role="status" wrapper with a screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading Notifications…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading Notifications…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-8">
        <div className="mx-auto max-w-4xl">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          <Skeleton className="mt-6 h-48 w-full" />
          <Skeleton className="mt-4 h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
