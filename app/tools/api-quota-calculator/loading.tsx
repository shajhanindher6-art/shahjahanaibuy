import { Skeleton } from '@/components/ui/skeleton';

/**
 * API Quota & Tier Calculator loading state (Section 16, E3).
 * Mirrors the tool page shape — heading + calculator form + tier
 * cards — using the same Skeleton primitives as the tools hub
 * loading state (app/tools/loading.tsx). Decorative only:
 * aria-hidden skeletons inside a role="status" wrapper with a
 * screen-reader label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading quota calculator…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading quota calculator…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <Skeleton className="h-9 w-80 max-w-full" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
          <div className="mt-8 space-y-3 rounded-lg border p-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-28" />
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="mt-4 space-y-3 rounded-lg border p-6">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
