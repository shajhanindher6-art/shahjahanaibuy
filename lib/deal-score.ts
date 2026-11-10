/**
 * Canonical Deal Score — ONE place that computes it (S2#10).
 *
 * Extracted verbatim from the inline formula that used to live only
 * in components/products/product-detail-client.tsx, so the product
 * page, search cards, similar-product cards and the comparison table
 * can no longer drift apart (the same product once showed a
 * different "Deal Score" on a similar card than on its own page).
 *
 * THE FORMULA (unchanged — do not "improve" it here; any re-weight
 * is a product decision, not a refactor):
 *   score = 100 − discountProbability × 0.4
 *         + (currentPrice && lowestPrice ? (lowestPrice / currentPrice) × 30 : 20)
 *         + confidenceScore × 0.3
 *   rounded to the nearest integer, clamped to 0–100.
 *
 * What it means (product page copy): the score rewards buying NOW —
 * a price at/near its recorded low scores highest — while a high
 * chance of a FUTURE price drop LOWERS it, because waiting may pay
 * off. So a high score next to a low discount probability means
 * "good now, no drop expected", not "a drop is coming".
 *
 * DISCOUNT-% BASIS (stated, not changed): this formula takes NO
 * discount-% input at all — it is built from the price-drop
 * prediction (discount probability, recorded low vs current price,
 * confidence). Wherever a discount % IS displayed alongside a Deal
 * Score, its basis is the merchant compare-at price
 * (lib/deal-math `discountPercent`: compare_at_price vs price) —
 * the basis product pages already use — never the deals-table
 * percentage. The two numbers answer different questions and must
 * never be mixed into one.
 *
 * HONESTY: returns null when the prediction inputs are missing or
 * not finite — a missing prediction is "no score", never a
 * synthesized default (and never 0, which would read as "terrible
 * deal"). Callers render no badge when this returns null.
 * The price term falls back to +20 exactly as the original inline
 * formula did when current/lowest price is absent — that +20 is
 * part of the formula, not a default score.
 */

export interface DealScoreInput {
  /** Probability (0–100) of a price drop in the near future. */
  discountProbability: number;
  /** Latest recorded price in USD, or null when unknown. */
  currentPrice: number | null;
  /** Lowest recorded price in USD, or null when unknown. */
  lowestPrice: number | null;
  /** Prediction confidence (0–100). */
  confidenceScore: number;
}

/** A price-drop prediction in the shape GET /api/v1/predictions/[id] returns. */
export interface DealScorePrediction {
  discountProbability: number;
  currentPrice: number | null;
  lowestPrice: number | null;
  confidenceScore: number;
}

/**
 * The canonical Deal Score (0–100), or null when it cannot be
 * computed honestly from the inputs.
 */
export function computeDealScore(input: DealScoreInput | null | undefined): number | null {
  if (!input) return null;
  const { discountProbability, currentPrice, lowestPrice, confidenceScore } = input;
  if (!Number.isFinite(discountProbability) || !Number.isFinite(confidenceScore)) {
    return null;
  }
  // Mirror the original inline truthiness: a missing/zero price
  // falls through to the +20 term instead of dividing by zero or
  // by a lowest price of 0.
  const priceTerm =
    currentPrice && lowestPrice ? (lowestPrice / currentPrice) * 30 : 20;
  if (!Number.isFinite(priceTerm)) return null;
  const raw =
    100 - discountProbability * 0.4 + priceTerm + confidenceScore * 0.3;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Convenience wrapper for a prediction object (or null) from the predictions API. */
export function computeDealScoreFromPrediction(
  prediction: DealScorePrediction | null | undefined
): number | null {
  if (!prediction) return null;
  return computeDealScore({
    discountProbability: prediction.discountProbability,
    currentPrice: prediction.currentPrice,
    lowestPrice: prediction.lowestPrice,
    confidenceScore: prediction.confidenceScore,
  });
}
