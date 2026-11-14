/**
 * Pure pricing helpers for the comparison matrix (Section 14,
 * Chunk 4 — B10/B11/B15).
 *
 * Everything here derives from the retailer rows the comparison
 * API already returns (price, discount %, compare-at price) — no
 * new data, no new fetch. Null means "no listing / no discount",
 * never a guessed number; the page renders words for nulls.
 */

import { formatPrice } from '@/lib/region';

export function formatUsd(amount: number): string {
  // Fixed 2 decimals: these are computed money labels (gaps,
  // ranges), where "$20.5" would read as a typo. Stage 2, S2-2:
  // delegates to the canonical formatPrice in lib/region.ts.
  return formatPrice(amount, 'USD', 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Best (largest) discount % across a product's retailers, or null
 * when no retailer lists a discount. The API computes each
 * retailer's discount from its compare-at price already — this
 * only takes the max.
 */
export function bestDiscount(
  retailers: Array<{ discount: number | null | undefined }>
): number | null {
  let best: number | null = null;
  for (const r of retailers) {
    if (typeof r.discount === 'number' && Number.isFinite(r.discount) && r.discount > 0) {
      if (best === null || r.discount > best) best = r.discount;
    }
  }
  return best;
}

/** Cheapest retailer price, or null when there are no listings. */
export function lowestRetailerPrice(prices: number[]): number | null {
  return prices.length > 0 ? Math.min(...prices) : null;
}

/**
 * How far a product's cheapest price sits above the cheapest price
 * in the whole comparison: "Cheapest" for the cheapest product,
 * "+$X vs cheapest" otherwise, null when either side has no price.
 */
export function priceGapLabel(
  minPrice: number | null | undefined,
  overallMin: number | null | undefined
): string | null {
  if (minPrice === null || minPrice === undefined) return null;
  if (overallMin === null || overallMin === undefined) return null;
  if (minPrice <= overallMin) return 'Cheapest';
  return `+${formatUsd(minPrice - overallMin)} vs cheapest`;
}

/**
 * Price range across a product's retailers: "$999 – $1,019", a
 * single "$999" when every listing shares one price, null when
 * there are no listings.
 */
export function priceRangeLabel(prices: number[]): string | null {
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return formatUsd(min);
  return `${formatUsd(min)} – ${formatUsd(max)}`;
}
