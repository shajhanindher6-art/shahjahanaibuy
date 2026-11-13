/**
 * Blog article loading state (Section 19, item 95). Mirrors the
 * article page shape — title, meta line, hero block, paragraphs.
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading article…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading article…</span>
      <main aria-hidden="true" className="container mx-auto flex-1 px-4 py-12">
        <article className="mx-auto max-w-2xl space-y-6">
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-56 w-full rounded-lg" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </article>
      </main>
    </div>
  );
}
