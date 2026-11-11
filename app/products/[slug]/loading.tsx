import { Skeleton } from '@/components/ui/skeleton';

/**
 * Product page loading state (Section 14, L-1). Mirrors the
 * product page shape — gallery, title, price, buy box — using the
 * same Skeleton primitives as the other route loading states.
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading product…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading product…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="grid gap-8 md:grid-cols-2">
          <Skeleton className="aspect-[4/3] w-full rounded-lg" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-10 w-full max-w-xs" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </div>
    </div>
  );
}
