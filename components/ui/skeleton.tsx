import { cn } from '@/lib/utils';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };

/**
 * Section skeletons (Section 4, item 2). Each one mirrors the shape of
 * the section it stands in for, so the page never shows a blank area
 * or a full-page spinner while data loads. Decorative only: every
 * skeleton is aria-hidden and its wrapper carries role="status" with
 * an accessible "Loading…" label.
 *
 * Wiring into pages is live (Section 10): app/loading.tsx,
 * app/search/loading.tsx, app/deals/loading.tsx and
 * app/compare/loading.tsx use these components as route loading states.
 */

function SkeletonShell({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-label={label} className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** Mirrors the product hero: image left, title/price/actions right. */
export function ProductHeroSkeleton({ className }: { className?: string }) {
  return (
    <SkeletonShell label="Loading product…" className={className}>
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="aspect-square w-full" />
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-10 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    </SkeletonShell>
  );
}

/** Mirrors the "Where to Buy" retailer list: 3 retailer rows. */
export function WhereToBuySkeleton({ className }: { className?: string }) {
  return (
    <SkeletonShell label="Loading retailers…" className={className}>
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 rounded-lg border p-4"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-9 w-24" />
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}

/** Mirrors the compare matrix: header row + 4 comparison rows. */
export function CompareMatrixSkeleton({ className }: { className?: string }) {
  return (
    <SkeletonShell label="Loading comparison…" className={className}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid grid-cols-3 gap-4 border-t pt-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}

/** Mirrors the dashboard stat cards: 4 cards in a row. */
export function DashboardCardsSkeleton({ className }: { className?: string }) {
  return (
    <SkeletonShell label="Loading dashboard…" className={className}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-3 rounded-lg border p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}
