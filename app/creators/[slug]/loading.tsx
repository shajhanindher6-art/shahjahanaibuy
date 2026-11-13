/**
 * Creator storefront loading state (Section 19, item 95). Mirrors
 * the storefront shape — avatar + name + product grid. (The parent
 * app/creators/loading.tsx covers the list; this one covers the
 * [slug] storefront itself.)
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading creator…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading creator…</span>
      <main aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-4 w-full" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="space-y-3 rounded-lg border p-4">
                <Skeleton className="h-32 w-full rounded-lg" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
