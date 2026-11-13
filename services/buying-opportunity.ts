/**
 * Buying-opportunity composite (Section 19, Phase 2 — §12 #25).
 *
 * Fragments existed (best-time-to-buy, deal urgency, drop-window,
 * alerts) but no single badge combined them. This service is that
 * combination — a PURE evaluation over real inputs only:
 *
 *   (1) at/near the recorded low — current price within 5% above
 *       the lowest recorded price;
 *   (2) fresh — the price was last checked within STALE_PRICE_DAYS
 *       (7), with a KNOWN check date (unknown age never counts);
 *   (3) validated discount — the recorded history shows a real
 *       drop from the 30-day peak (dropPct > 0) with NO
 *       fake-discount / inflation pattern (checkPriceInflation
 *       verdict `no_pattern`) across ≥2 recorded points;
 *   (4) in stock.
 *
 * ALL FOUR must hold. If any is missing the badge shows NOTHING
 * — not a weaker badge, not a partial signal. A partial badge
 * would read as a buying recommendation on evidence that does
 * not support one. `missing` names each unmet condition (for
 * tests and for callers that want to explain why there is no
 * badge); the component renders nothing either way.
 */

import { checkPriceInflation } from './inflation-check';
import type { FakeSalePoint } from './fake-sale';
import { getFreshnessStatus } from '@/lib/price-freshness';

/** Current price at/within this multiple of the recorded low counts as "near the low". */
export const BUYING_OPPORTUNITY_NEAR_LOW_TOLERANCE = 1.05;

export interface BuyingOpportunityInput {
  /** Latest recorded price, or null when none is recorded. */
  currentPrice: number | null;
  /** Lowest recorded price, or null when none is recorded. */
  lowestPrice: number | null;
  /** Recorded `products.data_freshness` (ISO) — null when unknown. */
  dataFreshness: string | null;
  /** Recorded price history (any order; detectors sort internally). */
  history: FakeSalePoint[];
  /** Whether any listing can actually be bought right now. */
  inStock: boolean;
  /** Reference time (defaults to now). Tests pass a fixed clock. */
  now?: Date;
}

export interface BuyingOpportunity {
  /** True only when ALL FOUR conditions hold. */
  qualifies: boolean;
  nearLow: boolean;
  fresh: boolean;
  discountValidated: boolean;
  inStock: boolean;
  /** Human reason per unmet condition (empty when qualified). */
  missing: string[];
  /** One-line evidence, only when qualified. */
  evidence: string | null;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Pure composite evaluation. Deterministic: same inputs in →
 * same result out. Invalid/missing inputs fail their condition,
 * never qualify and never crash.
 */
export function evaluateBuyingOpportunity(input: BuyingOpportunityInput): BuyingOpportunity {
  const now = input.now ?? new Date();
  const missing: string[] = [];

  const nearLow =
    input.currentPrice !== null &&
    input.lowestPrice !== null &&
    Number.isFinite(input.currentPrice) &&
    Number.isFinite(input.lowestPrice) &&
    input.lowestPrice > 0 &&
    input.currentPrice <= input.lowestPrice * BUYING_OPPORTUNITY_NEAR_LOW_TOLERANCE;
  if (!nearLow) {
    missing.push(
      input.currentPrice === null || input.lowestPrice === null
        ? 'No recorded current/lowest price to compare.'
        : `Current price (${money(input.currentPrice)}) is more than 5% above the recorded low (${money(input.lowestPrice)}).`
    );
  }

  const { status: freshness, ageDays } = getFreshnessStatus(input.dataFreshness, now);
  const fresh = freshness === 'fresh';
  if (!fresh) {
    missing.push(
      freshness === 'stale'
        ? `Price last checked ${ageDays} day${ageDays === 1 ? '' : 's'} ago — stale, not fresh.`
        : 'Price age unknown — no recorded check date.'
    );
  }

  // The "discount" being validated is the RECORDED drop from the
  // 30-day peak to the current price — not a merchant-claimed %.
  // It counts only when the drop is real (dropPct > 0) and no
  // fake-discount / inflation pattern explains it.
  const inflation = input.history.length >= 2 ? checkPriceInflation(input.history) : null;
  const discountValidated =
    inflation !== null &&
    inflation.verdict === 'no_pattern' &&
    inflation.dropPct !== null &&
    inflation.dropPct > 0;
  if (!discountValidated) {
    missing.push(
      inflation === null
        ? 'Not enough recorded price history to validate the discount.'
        : inflation.verdict === 'no_pattern'
          ? 'No real drop from the 30-day peak — there is no recorded discount to validate.'
          : `Discount not validated: ${inflation.reason}`
    );
  }

  const inStock = input.inStock === true;
  if (!inStock) missing.push('Out of stock — no listing can be bought right now.');

  const qualifies = nearLow && fresh && discountValidated && inStock;
  return {
    qualifies,
    nearLow,
    fresh,
    discountValidated,
    inStock,
    missing,
    evidence: qualifies
      ? `At ${money(input.currentPrice!)} — within 5% of the recorded low (${money(input.lowestPrice!)}), ` +
        `price checked ${ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`}, ` +
        `no fake-discount pattern in the last 30 days across ${input.history.length} recorded prices, in stock.`
      : null,
  };
}
