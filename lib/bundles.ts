/**
 * Combo bundles (Section 3, item 5).
 *
 * A combo bundle is an anchor product plus REAL compatible products
 * from the catalogue, graded by the compatibility matrix
 * (services/compatibility.ts — "Exact" is never assigned). The bundle
 * price is the SUM of the items' real lowest recorded merchant prices.
 * Savings come ONLY from real compare-at prices: savings = sum of
 * (compareAt - price) where a compare-at price is recorded and higher
 * than the price. No discount % is ever invented, no bundle-only
 * price exists, and unpriced products are listed as unpriced — never
 * given a guessed price.
 *
 * Pure functions only: no database, no network. The API route prices
 * candidates via services/commerce.getMerchantProducts and grades them
 * via services/compatibility.gradeCompatibility, then calls this.
 */

import type { CompatibilityGrade } from '@/services/compatibility';
import { BUNDLE_EXCLUDED_SLUGS } from '@/services/bundle-allocator';

export interface BundleItemInput {
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  /** Lowest recorded merchant price in USD, or null when unpriced. */
  lowestPriceUsd: number | null;
  /** Recorded compare-at price in USD, or null when not recorded. */
  compareAtPriceUsd?: number | null;
  grade?: CompatibilityGrade;
  gradeNote?: string;
}

export interface BundleTotals {
  /** Items in the bundle, anchor included. */
  itemCount: number;
  /** Items with a real recorded price. */
  pricedCount: number;
  /** Sum of recorded lowest prices (unpriced items contribute 0). */
  totalUsd: number;
  /** Sum of recorded compare-at prices (only where recorded). */
  compareAtTotalUsd: number;
  /** Real savings from compare-at prices only — 0 when none recorded. */
  savingsUsd: number;
  /** Slugs of items that could not be priced (shown as unpriced). */
  unpricedSlugs: string[];
}

export interface ComboBundle {
  anchor: BundleItemInput;
  items: BundleItemInput[];
  totals: BundleTotals;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function validPrice(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Bundle totals from real recorded prices only. Unpriced items are
 * listed in `unpricedSlugs` and contribute 0 — the total is a lower
 * bound until every item is priced, and the UI must say so.
 */
export function computeBundleTotals(items: BundleItemInput[]): BundleTotals {
  let totalUsd = 0;
  let compareAtTotalUsd = 0;
  let savingsUsd = 0;
  let pricedCount = 0;
  const unpricedSlugs: string[] = [];

  for (const item of items) {
    const price = validPrice(item.lowestPriceUsd);
    const compareAt = validPrice(item.compareAtPriceUsd ?? null);
    if (price === null) {
      unpricedSlugs.push(item.slug);
      continue;
    }
    pricedCount += 1;
    totalUsd += price;
    if (compareAt !== null && compareAt > price) {
      compareAtTotalUsd += compareAt;
      savingsUsd += compareAt - price;
    } else if (compareAt !== null) {
      compareAtTotalUsd += compareAt;
    }
  }

  return {
    itemCount: items.length,
    pricedCount,
    totalUsd: round2(totalUsd),
    compareAtTotalUsd: round2(compareAtTotalUsd),
    savingsUsd: round2(savingsUsd),
    unpricedSlugs,
  };
}

/**
 * Suggest a combo bundle for an anchor product from graded
 * candidates. Only priced, non-excluded candidates are used, best
 * grade first ("Likely" before "Possible" before "Unknown"), then
 * lowest price first. Sample Laptop and the anchor itself are never
 * included. Returns null when no priced candidate exists.
 */
export function suggestCombo(
  anchor: BundleItemInput,
  candidates: BundleItemInput[],
  maxItems = 3
): ComboBundle | null {
  const gradeOrder: Record<CompatibilityGrade, number> = {
    Likely: 0,
    Possible: 1,
    Unknown: 2,
  };
  const excluded = new Set<string>([...BUNDLE_EXCLUDED_SLUGS, anchor.slug]);

  const picked = candidates
    .filter((c) => !excluded.has(c.slug) && validPrice(c.lowestPriceUsd) !== null)
    .sort((a, b) => {
      const ga = gradeOrder[a.grade ?? 'Unknown'];
      const gb = gradeOrder[b.grade ?? 'Unknown'];
      if (ga !== gb) return ga - gb;
      return (a.lowestPriceUsd ?? 0) - (b.lowestPriceUsd ?? 0);
    })
    .slice(0, Math.max(0, maxItems));

  if (picked.length === 0) return null;

  const items = [anchor, ...picked];
  return { anchor, items, totals: computeBundleTotals(items) };
}
