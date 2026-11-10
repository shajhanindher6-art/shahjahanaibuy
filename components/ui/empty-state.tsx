import { cn } from '@/lib/utils';
import { LucideIcon, PackageOpen } from 'lucide-react';

/**
 * Shared empty state (Section 4 item 6).
 *
 * Every empty/error state on the site follows the same three-part
 * pattern — WHAT happened, WHY it happened, and the NEXT STEP:
 * - `eyebrow` (optional short label, e.g. "No results") + `title`
 *   say what happened,
 * - `description` says why (honest: never claim data exists when
 *   it does not — "No reviews yet", "No listings", never invented
 *   counts or reasons),
 * - `action` is the next step (a Button/Link — browse, retry,
 *   sign in, go home).
 *
 * Used by compare, dashboard, deals, tracking, wishlists and more.
 * Do not change the copy of a caller's empty state to claim data
 * that does not exist.
 */
export interface EmptyStateProps {
  /** Short label above the title, e.g. "No results". Optional. */
  eyebrow?: string;
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  eyebrow,
  icon: Icon = PackageOpen,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center',
        className
      )}
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      {eyebrow && (
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {eyebrow}
        </p>
      )}
      <h3 className="mb-1 text-lg font-semibold">{title}</h3>
      {description && (
        <p className="mb-4 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}
