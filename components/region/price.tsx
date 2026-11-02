'use client';

/**
 * <Price usd={...} /> — the single price renderer for the Global
 * website system.
 *
 * - USD visitors see exactly what they saw before: "$999.00".
 * - Other regions see an APPROXIMATE conversion (static FX rates
 *   from services/currency.ts, never a live rate) prefixed with
 *   "≈", plus the original USD value in small muted text, e.g.
 *   "≈ Rs 279,720  $999.00".
 * - `showOriginal={false}` hides the small USD text (used for
 *   strikethrough compare-at prices, where it would clutter).
 */

import { formatPriceForRegion, formatUsd } from '@/lib/region';
import { useRegion } from './region-provider';
import { cn } from '@/lib/utils';

interface PriceProps {
  /** Price in USD (all catalog prices are stored in USD). */
  usd: number;
  className?: string;
  /** Show the small original USD value next to a converted price. */
  showOriginal?: boolean;
}

export function Price({ usd, className, showOriginal = true }: PriceProps) {
  const { region } = useRegion();
  const { display, approximate } = formatPriceForRegion(usd, region);

  if (!approximate) {
    return <span className={className}>{display}</span>;
  }

  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5', className)}>
      <span>≈ {display}</span>
      {showOriginal && (
        <span className="text-xs font-normal text-muted-foreground">{formatUsd(usd)}</span>
      )}
    </span>
  );
}
