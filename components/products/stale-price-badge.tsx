'use client';

/**
 * Stale-price badge + age-in-days (Section 16, item 9).
 *
 * The product page already labels stale prices (lib/price-freshness
 * isPriceStale / formatLastChecked), but every list surface —
 * /products, /search, /deals, /compare, the homepage featured strip,
 * /brands/[slug] + /categories/[slug] cards, similar products and
 * wishlists — rendered prices with no freshness label at all. This
 * one component carries the label so all of them stay identical.
 *
 * Rendering rules (same as the product page, lib/price-freshness.ts):
 * - Unknown age (no recorded freshness) → "Price age unknown"
 *   (Section 19, Phase 2 §12 #21 — the old code rendered NOTHING,
 *   so a future row with no freshness timestamp showed no warning
 *   at all and read as fresh. Unknown is honest text, never a
 *   guessed date or age, and never silence).
 * - Fresh (≤ STALE_PRICE_DAYS, 7) → quiet "Price checked Nov 2 ·
 *   10 days old" line (the checked date is in the title tooltip).
 * - Stale (> 7 days) → amber "Stale price · N days old" badge.
 * Age 0 reads "checked today"; age 1 reads "1 day old".
 */

import { formatLastChecked, getPriceAgeDays, isPriceStale } from '@/lib/price-freshness';
import { cn } from '@/lib/utils';

interface StalePriceBadgeProps {
  /** Recorded `products.data_freshness` (ISO) — null/undefined when unknown. */
  dataFreshness?: string | null;
  className?: string;
}

export function StalePriceBadge({ dataFreshness, className }: StalePriceBadgeProps) {
  const age = getPriceAgeDays(dataFreshness);
  // Section 19, Phase 2 (§12 #21): unknown freshness used to
  // render nothing — indistinguishable from a fresh price. An
  // honest "age unknown" line is shown instead.
  if (age === null) {
    return (
      <span
        className={cn('text-xs text-muted-foreground', className)}
        title="No recorded price-check date for this product — the price age is unknown"
      >
        Price age unknown
      </span>
    );
  }
  const checked = formatLastChecked(dataFreshness);
  const stale = isPriceStale(dataFreshness);
  const ageLabel =
    age <= 0 ? 'checked today' : age === 1 ? '1 day old' : `${age} days old`;
  const title = checked
    ? `Prices last checked ${checked} — ${ageLabel}`
    : `Price age: ${ageLabel}`;

  if (stale) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200',
          className
        )}
        title={title}
      >
        Stale price · {ageLabel}
      </span>
    );
  }

  return (
    <span className={cn('text-xs text-muted-foreground', className)} title={title}>
      Price checked {checked ?? 'recently'} · {ageLabel}
    </span>
  );
}
