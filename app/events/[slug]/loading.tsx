/**
 * Event detail loading state (Section 19, item 95). Mirrors the
 * event page shape — title, date line, description, CTA.
 * (The parent app/events/loading.tsx covers the list; this one
 * covers the [slug] event itself.)
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading event…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading event…</span>
      <main aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-10 w-40 rounded-lg" />
        </div>
      </main>
    </div>
  );
}
