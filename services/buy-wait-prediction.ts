/**
 * Buy Now vs Wait prediction engine — deterministic, no LLM, no key.
 *
 * HONESTY RULES (do not weaken them):
 * - Input is ONLY the product's real recorded price_history points.
 * - A recommendation needs at least 5 points (Section 20, §12 #46
 *   — unified with the forecast minimum; was 2). With < 5 points
 *   the only output is "not enough price history to predict" — no
 *   verdict, no %.
 * - Confidence comes from the STATED formula below and is CAPPED LOW
 *   when history is thin (<= 4 points -> at most 25%). It is an
 *   estimate, never a guarantee. Section 20, §12 #46: the thin cap
 *   is now subsumed by the 5-point minimum (no verdict is issued
 *   below 5 points at all), but it stays as a defence-in-depth
 *   floor for the confidence formula itself.
 * - Seasonality is claimed ONLY when the history actually supports it:
 *   at least 12 points spanning at least 90 days. Otherwise the UI
 *   must say "not enough history for seasonal analysis".
 * - This engine NEVER outputs an exact future price or an exact future
 *   date. Older prediction displays that did so are retired, not reused.
 * - Section 19, Phase 3 (§12 #32): the verdict set also includes
 *   'track_price' (near the recorded low on low-confidence history
 *   — 5–11 points, confidence ≤ 45% — no strong buy or wait signal
 *   yet, so track the price) and 'compare_alternatives' (a cheaper
 *   alternative exists — compare before buying). Both need their
 *   stated inputs; without them the engine behaves exactly as
 *   before. (Section 20: the old track_price trigger was thin
 *   history ≤ 4 points, which the unified 5-point minimum made
 *   unreachable — the trigger is redefined to the 5–11-point
 *   low-confidence tier instead of retiring the verdict.)
 * - Section 19, Phase 3 (§12 #33): an optional budget input. When
 *   the current price is above the budget the verdict NEVER says
 *   buy_now — it says wait (or track) and states the gap
 *   ("above your budget by $X"). No budget supplied → unchanged.
 * - Section 19, Phase 3 (§12 #20 note, REVISED Section 21,
 *   Stage E E-P2-2): when the latest recorded price is stale
 *   (> 7 days, the STALE_PRICE_DAYS rule), the verdict is
 *   WITHHELD — the engine returns 'not_enough_data' with a reason
 *   that states the age — instead of issuing a buy/wait call on
 *   old data. The earlier behaviour (issue the verdict, qualified
 *   with the staleness in the reason) is retired: a qualified
 *   "Buy Now" on an 11-day-old price still reads as a current
 *   recommendation. `priceStale` / `daysSinceLastPrice` still
 *   expose the staleness to callers so the UI can explain WHY no
 *   verdict was given.
 */

import { STALE_PRICE_DAYS } from '@/lib/price-freshness';

export interface BuyWaitPoint {
  price: number;
  recordedAt: string;
}

export type BuyWaitRecommendation =
  | 'buy_now'
  | 'wait'
  | 'track_price'
  | 'compare_alternatives'
  | 'not_enough_data';

/**
 * Optional engine inputs (Section 19, Phase 3, §12 #32/#33). All
 * optional — with none supplied the engine behaves exactly as
 * before (buy_now / wait / not_enough_data only).
 */
export interface BuyWaitOptions {
  /**
   * The visitor's stated max budget in USD (§12 #33). When the
   * current price exceeds it, the verdict never says buy_now — it
   * says wait (or track) and states the gap.
   */
  budgetUsd?: number | null;
  /**
   * Price of a cheaper alternative product in USD (§12 #32).
   * When the current price is at least 5% above it, the verdict
   * is compare_alternatives. Pass null when no alternative is
   * known — the engine never invents one.
   */
  cheaperAlternativePrice?: number | null;
}

/**
 * TRACK PRICE when the price is near — but not at — its recorded
 * low: within 5% above the lowest recorded price. (At the low is
 * buy_now; further above it is wait territory.) Section 20: the
 * trigger is low confidence, not thin history — the 5–11-point
 * tier (confidence 45, or 35 when volatile), since the unified
 * 5-point minimum made the old ≤ 4-point trigger unreachable.
 * A clearly rising trend (slope > 2%, the same bar the wait
 * branch uses) is a wait signal, not a track signal — track
 * fires only when there is no strong signal either way.
 */
export const TRACK_PRICE_NEAR_LOW_FACTOR = 1.05;
/**
 * TRACK PRICE only fires while the verdict confidence is at most
 * this — the 5–11-point tier (45, or 35 when volatile). On deeper
 * history (12+ points, confidence ≥ 60) the same near-low shape
 * resolves to wait instead: the signal is strong enough to judge.
 */
export const TRACK_PRICE_MAX_CONFIDENCE = 45;
/**
 * COMPARE ALTERNATIVES when the alternative is at least 5%
 * cheaper than the current price — a smaller gap is noise, not a
 * reason to switch products.
 */
export const COMPARE_ALTERNATIVE_MIN_FACTOR = 1.05;

export interface BuyWaitPrediction {
  recommendation: BuyWaitRecommendation;
  /** 0-100. 0 only for not_enough_data. Never above 85: an estimate, not a guarantee. */
  confidence: number;
  /** One-line reason, always tied to the actual points. */
  reason: string;
  pointCount: number;
  spanDays: number;
  seasonalSupported: boolean;
  currentPrice: number | null;
  lowestPrice: number | null;
  averagePrice: number | null;
  /** Whole-percent slope of a least-squares fit over the span (null when < 5 points — no verdict is issued below the minimum). */
  slopePct: number | null;
  dropCount: number;
  daysSinceLastDrop: number | null;
  /** True when history is thin (<= 4 points): the UI must show the low-confidence label. Unreachable since §12 #46 (no verdict below 5 points); kept as a defence-in-depth flag. */
  lowConfidence: boolean;
  /**
   * Section 21, Stage E (E-P2-2) — True when the latest recorded
   * price is older than STALE_PRICE_DAYS (7). A stale price
   * withholds the verdict entirely (recommendation
   * 'not_enough_data', confidence 0) — the reason states the age
   * instead of presenting a buy/wait call as current. The flag
   * stays on the result so callers can explain the withholding.
   */
  priceStale: boolean;
  /** Whole days since the latest recorded price (null when < 5 points — no verdict is issued below the minimum). */
  daysSinceLastPrice: number | null;
  /**
   * Current price minus budget in USD, when a budget was supplied
   * and the current price exceeds it (null otherwise). The reason
   * always states this gap — never a buy above budget.
   */
  budgetGapUsd: number | null;
}

/** Minimum recorded points for any verdict (Section 20, §12 #46: unified at 5 with the forecast minimum). */
export const BUY_WAIT_MIN_POINTS = 5;
export const SEASONAL_MIN_POINTS = 12;
export const SEASONAL_MIN_SPAN_DAYS = 90;
/** Confidence is never presented above this: estimates are not guarantees. */
export const CONFIDENCE_CAP = 85;
/** Thin history (at or below this many points) caps confidence at 25%. */
export const THIN_HISTORY_MAX_POINTS = 4;
export const THIN_HISTORY_CONFIDENCE_CAP = 25;

function toMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

export function predictBuyVsWait(
  points: BuyWaitPoint[],
  options: BuyWaitOptions = {}
): BuyWaitPrediction {
  const valid = points
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(toMs(p.recordedAt)))
    .map((p) => ({ price: p.price, ms: toMs(p.recordedAt) }))
    .sort((a, b) => a.ms - b.ms);

  const base = {
    pointCount: valid.length,
    spanDays: 0,
    seasonalSupported: false,
    currentPrice: null as number | null,
    lowestPrice: null as number | null,
    averagePrice: null as number | null,
    slopePct: null as number | null,
    dropCount: 0,
    daysSinceLastDrop: null as number | null,
    lowConfidence: true,
    priceStale: false,
    daysSinceLastPrice: null as number | null,
    budgetGapUsd: null as number | null,
  };

  if (valid.length < BUY_WAIT_MIN_POINTS) {
    return {
      ...base,
      recommendation: 'not_enough_data',
      confidence: 0,
      reason:
        valid.length === 0
          ? 'Not enough price history to predict — no recorded prices yet.'
          : `Not enough price history to predict — only ${valid.length} recorded price${valid.length === 1 ? '' : 's'} so far (at least ${BUY_WAIT_MIN_POINTS} are needed).`,
    };
  }

  const prices = valid.map((p) => p.price);
  const current = prices[prices.length - 1];
  const lowest = Math.min(...prices);
  const average = prices.reduce((a, b) => a + b, 0) / prices.length;
  const spanDays = Math.max(0, Math.round((valid[valid.length - 1].ms - valid[0].ms) / 86_400_000));

  // Consecutive point-to-point decreases (real drops only).
  let drops = 0;
  let lastDropMs: number | null = null;
  for (let i = 1; i < valid.length; i++) {
    if (valid[i].price < valid[i - 1].price) {
      drops++;
      lastDropMs = valid[i].ms;
    }
  }
  const daysSinceLastDrop =
    lastDropMs === null ? null : Math.max(0, Math.round((Date.now() - lastDropMs) / 86_400_000));

  // Least-squares slope, expressed as % of the first price over the span.
  let slopePct: number | null = null;
  if (spanDays > 0) {
    const xs = valid.map((p) => (p.ms - valid[0].ms) / 86_400_000);
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = average;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - meanX) * (prices[i] - meanY);
      den += (xs[i] - meanX) * (xs[i] - meanX);
    }
    if (den > 0 && prices[0] > 0) slopePct = ((num / den) * spanDays) / prices[0] * 100;
  }

  const seasonalSupported =
    valid.length >= SEASONAL_MIN_POINTS && spanDays >= SEASONAL_MIN_SPAN_DAYS;

  // Confidence formula (stated, capped):
  //   base by point count: 5-11 -> 45, 12-29 -> 60, 30+ -> 75
  //   (the 2-4 -> 25 tier is unreachable since §12 #46 raised the
  //   minimum to 5; it stays as a defence-in-depth floor).
  //   minus 10 when prices are highly volatile (stddev/mean > 0.20)
  //   then capped at 85 overall, and at 25 when history is thin.
  let confidence = valid.length <= 4 ? 25 : valid.length <= 11 ? 45 : valid.length <= 29 ? 60 : 75;
  const variance = prices.reduce((s, p) => s + (p - average) ** 2, 0) / prices.length;
  const volatility = average > 0 ? Math.sqrt(variance) / average : 0;
  if (volatility > 0.2) confidence -= 10;
  confidence = Math.max(10, Math.min(CONFIDENCE_CAP, confidence));
  if (valid.length <= THIN_HISTORY_MAX_POINTS) {
    confidence = Math.min(confidence, THIN_HISTORY_CONFIDENCE_CAP);
  }
  const lowConfidence = valid.length <= THIN_HISTORY_MAX_POINTS;

  // Recommendation (Section 19, Phase 3, §12 #32/#33 — precedence
  // is deliberate and stated):
  //   1. OVER BUDGET → wait, with the gap stated (never buy_now
  //      above budget).   2. CHEAPER ALTERNATIVE (≥ 5% cheaper)
  //      → compare_alternatives.   3. AT/NEAR LOW or BELOW AVERAGE
  //      → buy_now.   4. LOW CONFIDENCE + NEAR LOW (within 5% above
  //      the low, not at it; confidence ≤ 45, i.e. the 5–11-point
  //      tier; no clearly rising trend) → track_price: no strong
  //      signal yet.
  //   5. Otherwise wait — the price has room to fall back toward
  //      its history and has dropped before.
  // With no budget and no alternative supplied, rules 1–2 never
  // fire and the engine behaves exactly as before.
  const atLowest = current <= lowest * 1.02;
  const belowAverage = current < average * 0.95;
  const aboveAverage = current > average * 1.05;

  // Optional inputs, validated: only finite positive numbers
  // count. An invalid budget/alternative is ignored, never
  // invented or guessed.
  const budget =
    typeof options.budgetUsd === 'number' &&
    Number.isFinite(options.budgetUsd) &&
    options.budgetUsd > 0
      ? options.budgetUsd
      : null;
  const cheaperAlternative =
    typeof options.cheaperAlternativePrice === 'number' &&
    Number.isFinite(options.cheaperAlternativePrice) &&
    options.cheaperAlternativePrice > 0
      ? options.cheaperAlternativePrice
      : null;
  const budgetGapUsd =
    budget !== null && current > budget
      ? Math.round((current - budget) * 100) / 100
      : null;

  // Freshness (§12 #20 note, revised Section 21 E-P2-2): the
  // verdict is only as current as the latest recorded price.
  // Older than STALE_PRICE_DAYS (7) → the verdict is WITHHELD
  // below (recommendation 'not_enough_data', confidence 0), not
  // merely qualified — a "Buy Now" on an 11-day-old price still
  // reads as a current recommendation. priceStale /
  // daysSinceLastPrice stay on the result so the UI can explain
  // WHY no verdict was given.
  const daysSinceLastPrice = Math.max(
    0,
    Math.floor((Date.now() - valid[valid.length - 1].ms) / 86_400_000)
  );
  const priceStale = daysSinceLastPrice > STALE_PRICE_DAYS;

  let recommendation: BuyWaitRecommendation;
  let reason: string;
  if (budgetGapUsd !== null && budget !== null) {
    recommendation = 'wait';
    reason = `Wait — the current price ($${current.toFixed(2)}) is above your budget by $${budgetGapUsd.toFixed(2)} (your budget: $${budget.toFixed(2)}). Buying now would exceed your budget${atLowest ? ', even though the price is at its recorded low' : ''} — wait for a drop or compare cheaper alternatives, based on ${valid.length} recorded points.`;
  } else if (
    cheaperAlternative !== null &&
    current > cheaperAlternative * COMPARE_ALTERNATIVE_MIN_FACTOR
  ) {
    recommendation = 'compare_alternatives';
    const saving = Math.round((current - cheaperAlternative) * 100) / 100;
    reason = `Compare alternatives — a cheaper alternative is available at $${cheaperAlternative.toFixed(2)}, $${saving.toFixed(2)} (${Math.round((saving / current) * 100)}%) less than the current price ($${current.toFixed(2)}). Check it before buying, based on ${valid.length} recorded points.`;
  } else if (atLowest) {
    recommendation = 'buy_now';
    reason = `Buy Now — the current price ($${current.toFixed(2)}) is at or near the lowest recorded price ($${lowest.toFixed(2)}), based on ${valid.length} recorded points.`;
  } else if (belowAverage) {
    recommendation = 'buy_now';
    reason = `Buy Now — the current price ($${current.toFixed(2)}) is below the recorded average ($${average.toFixed(2)}), based on ${valid.length} recorded points.`;
  } else if (
    confidence <= TRACK_PRICE_MAX_CONFIDENCE &&
    current <= lowest * TRACK_PRICE_NEAR_LOW_FACTOR &&
    !(slopePct !== null && slopePct > 2)
  ) {
    recommendation = 'track_price';
    reason = `Track the price — the current price ($${current.toFixed(2)}) is near the lowest recorded price ($${lowest.toFixed(2)}) but confidence is low (only ${valid.length} recorded points, ${confidence}% confidence), so there is no strong buy or wait signal yet. Set a price alert and decide once more prices are recorded.`;
  } else if (aboveAverage && drops > 0) {
    recommendation = 'wait';
    reason = `Wait — the current price ($${current.toFixed(2)}) is above the recorded average ($${average.toFixed(2)}) and this product has dropped ${drops} time${drops === 1 ? '' : 's'} before, based on ${valid.length} recorded points.`;
  } else if (slopePct !== null && slopePct > 2) {
    recommendation = 'wait';
    reason = `Wait — the price trend is rising (+${slopePct.toFixed(1)}% over the recorded span) and the current price ($${current.toFixed(2)}) is not near its low ($${lowest.toFixed(2)}), based on ${valid.length} recorded points.`;
  } else {
    recommendation = 'wait';
    reason = `Wait — the current price ($${current.toFixed(2)}) shows no strong buy signal against its recorded average ($${average.toFixed(2)}), based on ${valid.length} recorded points.`;
  }

  if (priceStale) {
    // Section 21, Stage E (E-P2-2) — WITHHOLD, do not qualify:
    // no buy/wait/track/compare verdict stands on a price older
    // than STALE_PRICE_DAYS. The facts (current/lowest/average,
    // slope, counts) stay on the result — they are recorded
    // history — but the recommendation is 'not_enough_data' and
    // the reason states the age and what would unblock a verdict
    // (a fresh price check). Callers that branch on
    // 'not_enough_data' (drop-window, monthly-planner, the chat
    // assistant) already render the honest empty state for it.
    recommendation = 'not_enough_data';
    confidence = 0;
    reason =
      `No verdict — the latest recorded price is ${daysSinceLastPrice} day${daysSinceLastPrice === 1 ? '' : 's'} old ` +
      `(last checked ${new Date(valid[valid.length - 1].ms).toISOString().slice(0, 10)}), older than the ${STALE_PRICE_DAYS}-day freshness window. ` +
      `A buy-now-or-wait call on stale data would present an old price as current; set a price alert and check back once the price is refreshed.`;
  }

  return {
    recommendation,
    confidence,
    reason,
    pointCount: valid.length,
    spanDays,
    seasonalSupported,
    currentPrice: current,
    lowestPrice: lowest,
    averagePrice: average,
    slopePct,
    dropCount: drops,
    daysSinceLastDrop,
    lowConfidence,
    priceStale,
    daysSinceLastPrice,
    budgetGapUsd,
  };
}
