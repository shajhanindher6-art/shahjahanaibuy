import { Skeleton } from '@/components/ui/skeleton';

/**
 * AI control center loading state (Section 19, Phase 7, §12 #71).
 * Mirrors the admin loading shape — heading, text lines, section
 * cards — using the same Skeleton primitives. Decorative only:
 * aria-hidden skeletons inside a role="status" wrapper with a
 * screen-reader "Loading…" label.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading AI control center…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading AI control center…</span>
      <div aria-hidden="true" className="container mx-auto flex-1 px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          <div className="mt-6 space-y-3 rounded-lg border p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
