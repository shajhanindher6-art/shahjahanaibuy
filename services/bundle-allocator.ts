/**
 * Budget-to-Cart Allocator — Enterprise feature #4.
 *
 * Pure, deterministic: same catalog + budget + categories in → same
 * bundle out. No I/O, no database, no network — fully unit-testable.
 *
 * OBJECTIVE (documented, in priority order):
 *   1. Maximize the number of requested categories covered — exactly
 *      one product per covered category (a bundle covers categories,
 *      it never doubles one).
 *   2. Minimize total spend for that coverage.
 *   3. Prefer lowest prices (deterministic tie-breaks: price asc,
 *      then category asc, then product slug asc).
 *
 * Why the greedy is optimal for this objective: each covered category
 * contributes exactly one item, so the cheapest eligible item in a
 * category is always the right pick for that category; to maximize
 * the COUNT under a budget, take the cheapest categories first
 * (exchange argument — any optimal bundle can swap in a cheaper
 * uncovered category without losing coverage). Total spend is then
 * minimal for that count by construction.
 *
 * HARD RULES (same as the gift finder and the AI assistant):
 * - Sample Laptop ('sample-laptop', a database health-check row) is
 *   NEVER recommended.
 * - Unpriced products (lowestPriceUsd null) are NEVER recommended.
 * - The total NEVER exceeds the budget.
 * - No price is ever invented: every pick carries the catalog's
 *   recorded lowest merchant price.
 */

import { EXCLUDED_SLUGS } from '@/lib/public-products';

/** Alias of the shared EXCLUDED_SLUGS (Stage 2, S2-1) — kept so existing importers keep working. */
export const BUNDLE_EXCLUDED_SLUGS = EXCLUDED_SLUGS;

/** One catalog product as the allocator sees it. */
export interface BundleCandidate {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  /** Lowest recorded merchant price in USD, or null when unpriced. */
  lowestPriceUsd: number | null;
}

export interface BundlePick extends BundleCandidate {
  /** The recorded lowest price actually charged to the bundle. */
  priceUsd: number;
}

export type BundleUncoveredReason = 'no-priced-product' | 'over-budget';

export interface BundleUncovered {
  category: string;
  reason: BundleUncoveredReason;
}

/**
 * Section 19, Phase 4 (§12 #38) — per-category budget split.
 *
 * The allocator used to re-score by category only: the caller saw
 * a total and a covered list, but never how the budget was divided.
 * Each requested category now gets an explicit share of the budget
 * — an equal split (budget / requested categories), with the
 * rounding remainder going to the first requested category — plus
 * what it actually spent and what is left of its share. A category
 * whose pick costs more than its share reports remaining 0 (the
 * overage is covered by unspent shares of other categories; the
 * TOTAL still never exceeds the budget — the greedy below
 * guarantees that). An uncovered category keeps its whole share
 * unspent. The split is a plan, not a per-category hard cap: a
 * category is never dropped for exceeding its share alone.
 */
export interface CategoryAllocation {
  category: string;
  /** This category's share of the budget (equal split, cents). */
  allocatedUsd: number;
  /** What the category's pick actually cost (0 when uncovered). */
  spentUsd: number;
  /** Share minus spend, floored at 0 (see header). */
  remainingUsd: number;
  /** Slug of the picked product, or null when uncovered. */
  productSlug: string | null;
}

export interface BundleResult {
  picks: BundlePick[];
  /** Total spend in USD, rounded to cents. */
  totalSpendUsd: number;
  budgetUsd: number;
  /** Requested categories that got a product, in requested order. */
  coveredCategories: string[];
  /** Requested categories with no product, in requested order. */
  uncovered: BundleUncovered[];
  /** Always true when picks exist (total never exceeds budget). */
  withinBudget: boolean;
  /** Per-category split of the budget, in requested order. */
  categoryAllocations: CategoryAllocation[];
}

function isEligible(p: BundleCandidate): p is BundleCandidate & {
  lowestPriceUsd: number;
} {
  if ((BUNDLE_EXCLUDED_SLUGS as readonly string[]).includes(p.slug)) {
    return false;
  }
  if (p.category === null || p.category.trim() === '') return false;
  if (p.lowestPriceUsd === null) return false;
  if (!Number.isFinite(p.lowestPriceUsd) || p.lowestPriceUsd <= 0) return false;
  return true;
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Allocate the best bundle for a budget across requested categories.
 *
 * Categories are de-duplicated (first-seen order kept); empty names
 * are dropped. A non-positive or non-finite budget covers nothing.
 */
export function allocateBundle(args: {
  budgetUsd: number;
  categories: string[];
  products: BundleCandidate[];
}): BundleResult {
  const { products } = args;
  const budgetUsd =
    Number.isFinite(args.budgetUsd) && args.budgetUsd > 0
      ? roundCents(args.budgetUsd)
      : 0;

  const requested: string[] = [];
  for (const raw of args.categories) {
    const category = raw.trim();
    if (category !== '' && !requested.includes(category)) {
      requested.push(category);
    }
  }

  if (requested.length === 0) {
    return {
      picks: [],
      totalSpendUsd: 0,
      budgetUsd,
      coveredCategories: [],
      uncovered: [],
      withinBudget: true,
      categoryAllocations: [],
    };
  }

  // Section 19, Phase 4 (§12 #38) — equal per-category split of
  // the budget. The rounding remainder (at most a few cents) goes
  // to the first requested category so the shares sum to the budget.
  const shareBase = Math.floor((budgetUsd * 100) / requested.length) / 100;
  const shareRemainder = roundCents(budgetUsd - shareBase * requested.length);
  const shareByCategory = new Map<string, number>(
    requested.map((category, i) => [
      category,
      roundCents(shareBase + (i === 0 ? shareRemainder : 0)),
    ])
  );

  // Cheapest eligible product per requested category.
  const cheapestByCategory = new Map<string, BundleCandidate & { lowestPriceUsd: number }>();
  for (const product of products) {
    if (!isEligible(product)) continue;
    const category = (product.category as string).trim();
    if (!requested.includes(category)) continue;
    const current = cheapestByCategory.get(category);
    if (
      !current ||
      product.lowestPriceUsd < current.lowestPriceUsd ||
      (product.lowestPriceUsd === current.lowestPriceUsd &&
        product.slug < current.slug)
    ) {
      cheapestByCategory.set(category, product);
    }
  }

  // Cheapest categories first — this order maximizes the count that
  // fits under the budget (see the objective note above).
  const ordered = [...cheapestByCategory.entries()]
    .map(([category, product]) => ({ category, product }))
    .sort((a, b) => {
      if (a.product.lowestPriceUsd !== b.product.lowestPriceUsd) {
        return a.product.lowestPriceUsd - b.product.lowestPriceUsd;
      }
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.product.slug.localeCompare(b.product.slug);
    });

  const picks: BundlePick[] = [];
  let total = 0;
  const covered = new Set<string>();
  for (const { category, product } of ordered) {
    if (roundCents(total + product.lowestPriceUsd) <= budgetUsd) {
      picks.push({ ...product, priceUsd: roundCents(product.lowestPriceUsd) });
      total = roundCents(total + product.lowestPriceUsd);
      covered.add(category);
    }
  }

  // Present picks in the user's requested category order (stable),
  // not in the internal cheapest-first order.
  const picksByCategory = new Map(picks.map((p) => [(p.category as string).trim(), p]));
  const orderedPicks = requested
    .filter((c) => picksByCategory.has(c))
    .map((c) => picksByCategory.get(c) as BundlePick);

  const uncovered: BundleUncovered[] = requested
    .filter((c) => !covered.has(c))
    .map((category) => ({
      category,
      reason: (cheapestByCategory.has(category)
        ? 'over-budget'
        : 'no-priced-product') as BundleUncoveredReason,
    }));

  return {
    picks: orderedPicks,
    totalSpendUsd: total,
    budgetUsd,
    coveredCategories: requested.filter((c) => covered.has(c)),
    uncovered,
    withinBudget: true,
    categoryAllocations: requested.map((category) => {
      const pick = picksByCategory.get(category);
      const allocatedUsd = shareByCategory.get(category) ?? 0;
      const spentUsd = pick ? pick.priceUsd : 0;
      return {
        category,
        allocatedUsd,
        spentUsd,
        remainingUsd: Math.max(0, roundCents(allocatedUsd - spentUsd)),
        productSlug: pick ? pick.slug : null,
      };
    }),
  };
}
