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
 * WHAT confidenceScore IS HERE (Section 20, §12 #67): the
 * PREDICTION confidence — the fit confidence computed from the
 * product's own recorded price history (services/ai-predictions.ts
 * calculateConfidence: point count + price spread). It is NEVER
 * the product row's confidence_score column, which is a
 * field-presence completeness count. No production caller passes
 * product.confidenceScore into this formula (verified 2026-11-13:
 * every caller passes the ai_predictions confidence_score); the
 * completeness column is therefore already decoupled from the Deal
 * Score — this note pins that, so a future caller does not
 * re-couple them.
 *
 * SECTION 20, §12 #45 — REBASE DEFERRED (do not change the
 * formula): the 100/100-on-every-product problem is a DATA
 * problem, not a formula problem, and re-basing now would
 * manufacture spread from 4 flat price points. The formula stays
 * exactly as written until real varied price history exists (a
 * live feed growing each product past 5 points with real rises
 * and drops); until then the score stays WITHHELD below 5 points
 * via dealScoreForDisplay. Never invent spread to make the
 * numbers look differentiated.
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
 *
 * FORMULA-vs-DATA DECISION (Section 19, Phase 2 — read before
 * "fixing" this formula): the 100/100-on-every-product problem is
 * a DATA problem as much as a formula problem. With the live
 * catalog's 4 recorded points per product, discount probability
 * is 0 and confidence is 20, so the formula computes
 * 100 − 0 + 30 + 6 = 136 and clamps to 100 — for EVERY product.
 * No re-weighting fixes that: any formula fed 4 points of a flat
 * series will either still clamp to 100 or invent a spread the
 * data does not support. So the formula is deliberately NOT
 * rebased here. Instead the score is WITHHELD below 5 data
 * points — dealScoreForDisplay returns null, and no product
 * surface may obtain a numeric score from fewer points (see the
 * caller-enforcement test, tests/section19-deal-score-gate.test.ts,
 * which greps every production caller). The ONLY production
 * caller of the raw formula is the Deal Score Breakdown tool
 * (lib/deal-score-breakdown.ts), a diagnostic that shows the raw
 * terms WITH the withheld warning, so the 100/100 is explained
 * instead of hidden. WHAT THE OWNER MUST SUPPLY for a real
 * score: more recorded price points over time — a live price
 * feed (eBay keys + applied refresh migrations, owner-gated)
 * growing each product past 5 points, with real rises and drops
 * so discount probability and confidence stop being 0 and 20.
 * Until then, "withheld" is the honest answer, not a new formula.
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
 *
 * RAW FORMULA — do NOT call this from a product surface. It has
 * NO data-points gate: on the live catalog's 4-point histories it
 * returns a meaningless 100/100 (see the header comment). Product
 * surfaces must call dealScoreForDisplay, which withholds the
 * score below DEAL_SCORE_MIN_DATA_POINTS. The only legitimate
 * production caller of this function is the Deal Score Breakdown
 * tool (lib/deal-score-breakdown.ts), which shows the raw terms
 * alongside the withheld warning. Tests may call it directly to
 * pin the formula itself.
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

/** Convenience wrapper for a prediction object (or null) from the predictions API.
 * Same rule as computeDealScore: raw formula, no data-points gate —
 * product surfaces must use dealScoreForDisplay instead. */
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
