import { CompareMatrixSkeleton, Skeleton } from '@/components/ui/skeleton';

/**
 * Compare loading state (Section 10, chunk 2). Reuses the
 * CompareMatrixSkeleton from components/ui/skeleton.tsx — the same
 * skeleton the compare page itself renders while a comparison
 * loads — plus product-picker input skeletons. Decorative only:
 * aria-hidden skeletons inside a role="status" wrapper with a
 * screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading comparison…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading comparison…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-6xl">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
          {/* Product pickers */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
          {/* Comparison matrix */}
          <div className="mt-8">
            <CompareMatrixSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}
