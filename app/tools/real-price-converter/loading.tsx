import { Skeleton } from '@/components/ui/skeleton';

/**
 * Per-tool loading state (Section 16, E5–E11). Mirrors the tool
 * page shape — heading + form card — using the same Skeleton
 * primitives as the tools hub loading state (app/tools/loading.tsx).
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading tool…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading tool…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
          <div className="mt-8 space-y-3 rounded-lg border p-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-32" />
          </div>
        </div>
      </div>
    </div>
  );
}
