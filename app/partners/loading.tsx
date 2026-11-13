/**
 * Partners loading state (Section 19, item 95). Mirrors the
 * partners page shape — heading + partner cards.
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading partners…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading partners…</span>
      <main aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="space-y-3 text-center">
            <Skeleton className="mx-auto h-9 w-56" />
            <Skeleton className="mx-auto h-4 w-96 max-w-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-3 rounded-lg border p-4">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
