import { Skeleton } from '@/components/ui/skeleton';

/**
 * Price Volatility Ranking loading state (Section 16, E1). Mirrors
 * the tool page shape — heading + sort form + ranked cards — using
 * the same Skeleton primitives as the tools hub loading state
 * (app/tools/loading.tsx). Decorative only: aria-hidden skeletons
 * inside a role="status" wrapper with a screen-reader label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading volatility ranking…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading volatility ranking…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
          <div className="mt-8 space-y-3 rounded-lg border p-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-24" />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="mt-4 space-y-3 rounded-lg border p-6">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
