/**
 * Widget embed loading state (Section 19, item 95). The embed page
 * renders a bare widget (no site chrome), so this is a minimal
 * widget-shaped skeleton — heading + rows — not a full page shell.
 * Decorative only: aria-hidden skeletons inside a role="status"
 * wrapper with a screen-reader "Loading…" label.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading widget…" className="flex min-h-screen flex-col items-center justify-center p-4">
      <span className="sr-only">Loading widget…</span>
      <div aria-hidden="true" className="w-full max-w-md space-y-4 rounded-lg border p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}
