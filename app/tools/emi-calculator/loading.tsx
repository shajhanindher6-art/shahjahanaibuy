import { Skeleton } from '@/components/ui/skeleton';

/**
 * Emi Calculator loading state (Section 18, item 64 / audit §1 #79).
 * Mirrors the tool page shape — heading, description, form card —
 * using the same Skeleton primitives as the other route loading
 * states. Decorative only: aria-hidden skeletons inside a
 * role="status" wrapper with a screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading Emi Calculator…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading Emi Calculator…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
          <div className="mt-8 space-y-4 rounded-lg border p-6">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="mt-2 h-11 w-full max-w-xs" />
          </div>
        </div>
      </div>
    </div>
  );
}
