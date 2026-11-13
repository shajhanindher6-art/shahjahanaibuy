/**
 * Live session loading state (Section 19, item 95 — highest
 * priority: this segment does a data fetch). Mirrors the session
 * shape — video block, title, session details.
 * (The parent app/live/loading.tsx covers the list; this one covers
 * the [slug] session itself.)
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading live session…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading live session…</span>
      <main aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl space-y-6">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-10 w-40 rounded-lg" />
        </div>
      </main>
    </div>
  );
}
