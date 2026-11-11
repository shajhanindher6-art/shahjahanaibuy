import { Skeleton } from '@/components/ui/skeleton';

/**
 * Sustainability loading state (Section 14, L-1). Mirrors the sustainability shape — heading, text lines — using the same
 * Skeleton primitives as the other route loading states.
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading sustainability…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading sustainability…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
      </div>
    </div>
  );
}
