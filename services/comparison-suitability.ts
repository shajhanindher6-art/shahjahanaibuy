/**
 * Per-requirement suitability explanations (Section 19, Phase 5,
 * §12 #51).
 *
 * The comparison used to give only a generic template + 3 spec-gated
 * badges, and no use-case input was ever collected. This module adds
 * plain-words suitability prose for each requirement a shopper
 * actually weighs — lowest price, highest rating, widest
 * availability, best discount — explaining WHICH product suits that
 * requirement better and WHY, grounded in the real comparison rows
 * (price, rating, availability, history). Where the data for a
 * requirement doesn't exist, the explanation says so instead of
 * inventing a reason.
 *
 * Pure function over the already-built ComparisonProduct rows: no
 * DB, no network, no invented specs. A tie names every tied product
 * (never a false single winner); a missing signal earns a
 * `dataMissing` note, never a fabricated winner.
 */

import type { ComparisonProduct } from '@/types/ai';

export interface SuitabilityExplanation {
  /** The requirement, e.g. "Lowest price". */
  requirement: string;
  /** Winning product id, or null when no winner can be named. */
  bestProductId: string | null;
  bestProductName: string | null;
  /** Plain-words explanation: the winner + the real reason, or the honest gap. */
  explanation: string;
  /** What data is missing for this requirement (null when explained from data). */
  dataMissing: string | null;
}

function lowestPrice(p: ComparisonProduct): number | null {
  const prices = p.retailers.map((r) => r.price).filter((n) => Number.isFinite(n));
  return prices.length > 0 ? Math.min(...prices) : null;
}

function avgRating(p: ComparisonProduct): number | null {
  const rating = p.retailers.find((r) => r.rating !== null && r.rating !== undefined)?.rating;
  return rating !== null && rating !== undefined ? rating : null;
}

function inStockCount(p: ComparisonProduct): number {
  return p.retailers.filter((r) => r.availability === 'in_stock').length;
}

function bestDiscount(p: ComparisonProduct): number | null {
  const discounts = p.retailers
    .map((r) => r.discount)
    .filter((d): d is number => d !== null && d !== undefined && Number.isFinite(d) && d > 0);
  return discounts.length > 0 ? Math.max(...discounts) : null;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * One suitability explanation per requirement, in a fixed order
 * (price, rating, availability, discount). Returns [] when fewer
 * than 2 products are compared.
 */
export function buildSuitabilityExplanations(
  products: ComparisonProduct[]
): SuitabilityExplanation[] {
  if (!products || products.length < 2) return [];
  const out: SuitabilityExplanation[] = [];

  // — Lowest price: suits a tight budget. —
  const priced = products
    .map((p) => ({ product: p, price: lowestPrice(p) }))
    .filter((c): c is { product: ComparisonProduct; price: number } => c.price !== null);
  if (priced.length === 0) {
    out.push({
      requirement: 'Lowest price',
      bestProductId: null,
      bestProductName: null,
      explanation:
        'No product in this comparison has a recorded price, so no product can be recommended for a tight budget.',
      dataMissing: 'No recorded prices for any compared product.',
    });
  } else {
    const min = Math.min(...priced.map((c) => c.price));
    const winners = priced.filter((c) => c.price === min);
    if (winners.length === 1) {
      const winner = winners[0];
      const runnerUp = priced
        .filter((c) => c.price > min)
        .sort((a, b) => a.price - b.price)[0];
      out.push({
        requirement: 'Lowest price',
        bestProductId: winner.product.productId,
        bestProductName: winner.product.name,
        explanation:
          `${winner.product.name} suits a tight budget best — its lowest recorded price is ${money(min)}` +
          (runnerUp
            ? `, ${money(runnerUp.price - min)} less than ${runnerUp.product.name} at ${money(runnerUp.price)}.`
            : '.'),
        dataMissing: null,
      });
    } else {
      out.push({
        requirement: 'Lowest price',
        bestProductId: null,
        bestProductName: null,
        explanation:
          `${joinNames(winners.map((w) => w.product.name))} are tied at the lowest recorded price of ${money(min)} — either suits a tight budget equally on price alone.`,
        dataMissing: null,
      });
    }
  }

  // — Highest rated: suits a shopper who weighs other buyers' experience. —
  const rated = products
    .map((p) => ({ product: p, rating: avgRating(p) }))
    .filter((c): c is { product: ComparisonProduct; rating: number } => c.rating !== null);
  if (rated.length === 0) {
    out.push({
      requirement: 'Highest rated',
      bestProductId: null,
      bestProductName: null,
      explanation:
        'No ratings are recorded for any compared product, so no product can be recommended on buyer experience — the comparison cannot say which is better liked.',
      dataMissing: 'No ratings recorded for any compared product.',
    });
  } else {
    const max = Math.max(...rated.map((c) => c.rating));
    const winners = rated.filter((c) => c.rating === max);
    if (winners.length === 1) {
      out.push({
        requirement: 'Highest rated',
        bestProductId: winners[0].product.productId,
        bestProductName: winners[0].product.name,
        explanation:
          `${winners[0].product.name} suits a shopper who weighs buyer experience best — it has the highest recorded rating at ${max.toFixed(1)} stars.`,
        dataMissing: null,
      });
    } else {
      out.push({
        requirement: 'Highest rated',
        bestProductId: null,
        bestProductName: null,
        explanation:
          `${joinNames(winners.map((w) => w.product.name))} are tied at the highest recorded rating of ${max.toFixed(1)} stars — neither is better liked on the recorded ratings.`,
        dataMissing: null,
      });
    }
  }

  // — Widest availability: suits a shopper who needs it in stock now. —
  const availability = products.map((p) => ({ product: p, count: inStockCount(p) }));
  const maxAvailable = Math.max(0, ...availability.map((c) => c.count));
  if (maxAvailable === 0) {
    out.push({
      requirement: 'Widest availability',
      bestProductId: null,
      bestProductName: null,
      explanation:
        'None of the compared products is recorded in stock at any retailer right now, so no product can be recommended for immediate availability.',
      dataMissing: null,
    });
  } else {
    const winners = availability.filter((c) => c.count === maxAvailable);
    if (winners.length === 1) {
      out.push({
        requirement: 'Widest availability',
        bestProductId: winners[0].product.productId,
        bestProductName: winners[0].product.name,
        explanation:
          `${winners[0].product.name} suits a shopper who needs it in stock now best — it is recorded in stock at ${maxAvailable} retailer${maxAvailable === 1 ? '' : 's'}, more than any other compared product.`,
        dataMissing: null,
      });
    } else {
      out.push({
        requirement: 'Widest availability',
        bestProductId: null,
        bestProductName: null,
        explanation:
          `${joinNames(winners.map((w) => w.product.name))} are tied for widest availability (${maxAvailable} retailer${maxAvailable === 1 ? '' : 's'} each in stock) — either is equally obtainable on the recorded listings.`,
        dataMissing: null,
      });
    }
  }

  // — Best discount: suits a deal hunter. —
  const discounted = products
    .map((p) => ({ product: p, discount: bestDiscount(p) }))
    .filter((c): c is { product: ComparisonProduct; discount: number } => c.discount !== null);
  if (discounted.length === 0) {
    out.push({
      requirement: 'Best discount',
      bestProductId: null,
      bestProductName: null,
      explanation:
        'No discount is listed for any compared product, so no product can be recommended as the best deal — the comparison cannot say which saves more.',
      dataMissing: 'No discount listed for any compared product.',
    });
  } else {
    const max = Math.max(...discounted.map((c) => c.discount));
    const winners = discounted.filter((c) => c.discount === max);
    if (winners.length === 1) {
      out.push({
        requirement: 'Best discount',
        bestProductId: winners[0].product.productId,
        bestProductName: winners[0].product.name,
        explanation:
          `${winners[0].product.name} suits a deal hunter best — it carries the largest recorded discount at ${max}% off its compare-at price.`,
        dataMissing: null,
      });
    } else {
      out.push({
        requirement: 'Best discount',
        bestProductId: null,
        bestProductName: null,
        explanation:
          `${joinNames(winners.map((w) => w.product.name))} are tied at the largest recorded discount of ${max}% off — either saves the same on the recorded listings.`,
        dataMissing: null,
      });
    }
  }

  return out;
}
