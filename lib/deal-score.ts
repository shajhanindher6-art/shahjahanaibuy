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
  /**
   * Number of recorded price-history points behind this
   * prediction (Section 15, B1). The live catalog has 4 points
   * per product, which is why every product scores 100/100:
   * 4 points → discount probability 0, confidence 20 →
   * 100 − 0 + 30 + 6 = 136, clamped to 100. The formula is
   * NOT rebased — instead the badge is hidden until the
   * prediction rests on enough points (see
   * DEAL_SCORE_MIN_DATA_POINTS). Null/undefined when the
   * prediction came from a source that does not carry the
   * count (e.g. a cached row written before B1) — treated as
   * "not enough data", never as 0 points.
   */
  dataPoints?: number | null;
}

/**
 * Minimum price-history points for a Deal Score to be shown
 * (Section 15, B1). Below this the score is a 4-point artifact
 * (see DealScorePrediction.dataPoints), so callers hide the
 * badge instead of showing a 100/100 that means nothing.
 * A threshold, not a formula change: computeDealScore is
 * untouched.
 */
export const DEAL_SCORE_MIN_DATA_POINTS = 5;

/**
 * Whether a Deal Score may be SHOWN for a prediction resting
 * on `dataPoints` recorded prices. False for null/undefined
 * (unknown count — hide, never guess) and for anything below
 * DEAL_SCORE_MIN_DATA_POINTS.
 */
export function shouldShowDealScore(dataPoints: number | null | undefined): boolean {
  return (
    typeof dataPoints === 'number' &&
    Number.isFinite(dataPoints) &&
    dataPoints >= DEAL_SCORE_MIN_DATA_POINTS
  );
}

/**
 * Honest "why is there no score" label (Section 16, item 10).
 * The badge is correctly hidden below DEAL_SCORE_MIN_DATA_POINTS,
 * but nothing told the visitor why — a missing badge read as a
 * broken page. Returns the withheld label when the count is known
 * and below the threshold, null otherwise (shown, or unknown count
 * — the caller renders nothing rather than guessing a count).
 * The formula is untouched; this is display copy only.
 */
export function formatDealScoreWithheld(
  dataPoints: number | null | undefined
): string | null {
  if (
    typeof dataPoints !== 'number' ||
    !Number.isFinite(dataPoints) ||
    dataPoints >= DEAL_SCORE_MIN_DATA_POINTS
  ) {
    return null;
  }
  return (
    `Deal Score withheld — only ${dataPoints} of ` +
    `${DEAL_SCORE_MIN_DATA_POINTS} price points recorded`
  );
}

/**
 * The display gate for a Deal Score: the canonical score when
 * the prediction rests on enough price points, null otherwise.
 * The formula itself (computeDealScoreFromPrediction) is
 * unchanged — this only decides whether the number is honest
 * enough to show. Callers render no badge when this returns
 * null.
 */
export function dealScoreForDisplay(
  prediction: DealScorePrediction | null | undefined
): number | null {
  if (!prediction) return null;
  if (!shouldShowDealScore(prediction.dataPoints)) return null;
  return computeDealScoreFromPrediction(prediction);
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
