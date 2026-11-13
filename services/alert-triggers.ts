/**
 * Alert trigger evaluation (Section 19, Phase 6 — §12 #61–#64).
 *
 * PURE functions over recorded price data — no I/O, no Supabase,
 * no invented prices. The checker (`services/alert-checker.ts`)
 * supplies the recorded rows; these functions decide whether a
 * trigger fires and build the evidence the notification carries.
 *
 * - Significant drop (#61): the latest recorded price fell by at
 *   least SIGNIFICANT_DROP_THRESHOLD_PCT (10%) versus the previous
 *   recorded price. The drop is a fact from two recorded points;
 *   the Phase 2 deal validation (`validateDealDiscount`) is reused
 *   for the evidence — a drop measured against a recently raised
 *   price is labelled as a possible fake-discount pattern instead
 *   of being presented as a clean bargain.
 * - Trend (#62): the recorded history over the last 30 days trends
 *   down (or up) by at least TREND_MIN_CHANGE_PCT (5%), with the
 *   regression slope agreeing with the start→end change. Fewer
 *   than TREND_MIN_POINTS (5) recorded points in the window means
 *   the trend does NOT fire — a trend on 4 points is never
 *   presented as confident. 5–6 points still fire but the evidence
 *   says the trend is based on limited data.
 * - Wishlist (#63): per wishlist item — target-price hit, a real
 *   out→in stock transition, or a significant drop. The item's own
 *   recorded target_price is the trigger; nothing is invented.
 * - Opportunity (#64): the Phase 2 buying-opportunity composite
 *   (`evaluateBuyingOpportunity`) — near the recorded low + fresh
 *   + validated discount + in stock. Reused, never re-implemented:
 *   the alert fires only when the composite qualifies.
 */

import { validateDealDiscount, type DealDiscountValidation } from './deal-validation';
import {
  evaluateBuyingOpportunity,
  type BuyingOpportunityInput,
} from './buying-opportunity';
import type { FakeSalePoint } from './fake-sale';

// ---------------------------------------------------------------------------
// Thresholds (documented in code — these ARE the definitions)
// ---------------------------------------------------------------------------

/** A drop of at least this % vs the previous recorded price counts as "significant". */
export const SIGNIFICANT_DROP_THRESHOLD_PCT = 10;

/** Trend window: recorded points within this many days of the latest point. */
export const TREND_WINDOW_DAYS = 30;

/** Fewer than this many points in the trend window → no trend alert (never confident on ≤4). */
export const TREND_MIN_POINTS = 5;

/** A trend must move the price by at least this % start→end to fire. */
export const TREND_MIN_CHANGE_PCT = 5;

/** Points below this count still fire, but the evidence says the trend is based on limited data. */
export const TREND_LIMITED_DATA_MAX_POINTS = 6;

/** Wishlist significant-drop threshold — same definition as #61. */
export const WISHLIST_DROP_THRESHOLD_PCT = SIGNIFICANT_DROP_THRESHOLD_PCT;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Newest first. Invalid / non-finite rows are dropped, never guessed. */
function sortedNewestFirst(history: FakeSalePoint[]): FakeSalePoint[] {
  return [...history]
    .filter(
      (p) =>
        p &&
        Number.isFinite(p.price) &&
        p.price > 0 &&
        Number.isFinite(new Date(p.recordedAt).getTime())
    )
    .sort(
      (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
    );
}

// ---------------------------------------------------------------------------
// #61 — Significant drop
// ---------------------------------------------------------------------------

export interface SignificantDropEvaluation {
  fires: boolean;
  /** Latest recorded price, or null when no usable point exists. */
  newPrice: number | null;
  /** Previous recorded price, or null when fewer than 2 points exist. */
  oldPrice: number | null;
  /** Drop % ((old − new) / old × 100), or null when not computable. */
  dropPct: number | null;
  newRecordedAt: string | null;
  oldRecordedAt: string | null;
  /** Phase 2 deal validation of the drop (evidence, never a second gate). */
  validation: DealDiscountValidation | null;
  /** Human reason, always tied to the recorded numbers. */
  reason: string;
}

export function evaluateSignificantDrop(
  history: FakeSalePoint[],
  thresholdPct: number = SIGNIFICANT_DROP_THRESHOLD_PCT
): SignificantDropEvaluation {
  const points = sortedNewestFirst(history);
  const noValidation = {
    newPrice: points[0]?.price ?? null,
    oldPrice: points[1]?.price ?? null,
    dropPct: null as number | null,
    newRecordedAt: points[0]?.recordedAt ?? null,
    oldRecordedAt: points[1]?.recordedAt ?? null,
    validation: null as DealDiscountValidation | null,
  };

  if (points.length < 2) {
    return {
      ...noValidation,
      fires: false,
      reason: `Only ${points.length} recorded price point${points.length === 1 ? '' : 's'} — a drop cannot be measured from fewer than 2.`,
    };
  }

  const [latest, previous] = points;
  const dropPct =
    previous.price > 0
      ? Math.round(((previous.price - latest.price) / previous.price) * 1000) / 10
      : null;

  if (dropPct === null || dropPct < thresholdPct) {
    return {
      ...noValidation,
      dropPct,
      fires: false,
      reason:
        dropPct === null
          ? 'Previous recorded price is not positive — the drop cannot be measured.'
          : `Latest recorded price (${money(latest.price)}) is only ${dropPct}% below the previous recorded price (${money(previous.price)}) — below the ${thresholdPct}% significant-drop threshold.`,
    };
  }

  // Reuse Phase 2 validation for the evidence: the drop is real
  // (two recorded points), but when the history shows a
  // fake-discount / inflation pattern the alert must say so —
  // the "drop" may be measured against a recently raised price.
  const validation = validateDealDiscount({
    history: points,
    currentPrice: latest.price,
    discountType: 'percentage',
    discountValue: dropPct,
  });

  const reason =
    `Price fell ${dropPct}% — from ${money(previous.price)} (recorded ${previous.recordedAt}) ` +
    `to ${money(latest.price)} (recorded ${latest.recordedAt}). ${validation.reason}`;
  return {
    ...noValidation,
    dropPct,
    validation,
    fires: true,
    reason,
  };
}

// ---------------------------------------------------------------------------
// #62 — Trend
// ---------------------------------------------------------------------------

export type TrendDirection = 'down' | 'up';

export interface TrendEvaluation {
  fires: boolean;
  direction: TrendDirection | null;
  /** Start→end change % over the window, or null when not computable. */
  changePct: number | null;
  /** Least-squares slope ($/day) over the window, or null. */
  slopePerDay: number | null;
  /** Recorded points inside the window. */
  points: number;
  windowDays: number;
  startPrice: number | null;
  endPrice: number | null;
  startRecordedAt: string | null;
  endRecordedAt: string | null;
  /** True when the window holds fewer than TREND_MIN_POINTS points — the trend never fires then. */
  limitedData: boolean;
  /** Human reason, always tied to the recorded numbers. */
  reason: string;
}

export function evaluateTrend(
  history: FakeSalePoint[],
  windowDays: number = TREND_WINDOW_DAYS
): TrendEvaluation {
  const points = sortedNewestFirst(history);
  const base = {
    direction: null as TrendDirection | null,
    changePct: null as number | null,
    slopePerDay: null as number | null,
    points: 0,
    windowDays,
    startPrice: null as number | null,
    endPrice: null as number | null,
    startRecordedAt: null as string | null,
    endRecordedAt: null as string | null,
    limitedData: false,
  };

  if (points.length === 0) {
    return { ...base, fires: false, limitedData: true, reason: 'No recorded price points — no trend can be measured.' };
  }

  const latestAt = new Date(points[0].recordedAt).getTime();
  const windowStart = latestAt - windowDays * 24 * 60 * 60 * 1000;
  // Oldest first inside the window (regression + start→end need order).
  const windowPoints = points
    .filter((p) => new Date(p.recordedAt).getTime() >= windowStart)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  if (windowPoints.length < TREND_MIN_POINTS) {
    return {
      ...base,
      points: windowPoints.length,
      fires: false,
      limitedData: true,
      reason:
        `Only ${windowPoints.length} recorded price point${windowPoints.length === 1 ? '' : 's'} ` +
        `in the last ${windowDays} days — too little data for a trend alert (minimum ${TREND_MIN_POINTS}).`,
    };
  }

  const first = windowPoints[0];
  const last = windowPoints[windowPoints.length - 1];
  const changePct =
    first.price > 0
      ? Math.round(((last.price - first.price) / first.price) * 1000) / 10
      : null;

  // Least-squares slope over (days since window start, price).
  const xs = windowPoints.map(
    (p) => (new Date(p.recordedAt).getTime() - new Date(first.recordedAt).getTime()) / 86_400_000
  );
  const ys = windowPoints.map((p) => p.price);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - meanX) ** 2;
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
  }
  const slopePerDay = sxx === 0 ? 0 : Math.round((sxy / sxx) * 100) / 100;

  const limitedNote =
    windowPoints.length <= TREND_LIMITED_DATA_MAX_POINTS
      ? ` Based on limited data — only ${windowPoints.length} recorded prices in the window.`
      : '';
  const evidence =
    `Over the last ${windowDays} days (${windowPoints.length} recorded prices): ` +
    `${money(first.price)} (${first.recordedAt}) → ${money(last.price)} (${last.recordedAt}), ` +
    `${changePct === null ? 'change not measurable' : `${changePct}%`}.` +
    limitedNote;

  if (changePct === null) {
    return {
      ...base,
      points: windowPoints.length,
      slopePerDay,
      startPrice: first.price,
      endPrice: last.price,
      startRecordedAt: first.recordedAt,
      endRecordedAt: last.recordedAt,
      fires: false,
      reason: `Starting recorded price is not positive — the trend change cannot be measured. ${evidence}`,
    };
  }

  // Direction needs BOTH the start→end move and the slope to
  // agree — a single low last point against an upward slope is
  // noise, not a trend.
  if (changePct <= -TREND_MIN_CHANGE_PCT && slopePerDay < 0) {
    return {
      ...base,
      direction: 'down',
      changePct,
      slopePerDay,
      points: windowPoints.length,
      startPrice: first.price,
      endPrice: last.price,
      startRecordedAt: first.recordedAt,
      endRecordedAt: last.recordedAt,
      fires: true,
      reason: `Price trending down: ${evidence}`,
    };
  }
  if (changePct >= TREND_MIN_CHANGE_PCT && slopePerDay > 0) {
    return {
      ...base,
      direction: 'up',
      changePct,
      slopePerDay,
      points: windowPoints.length,
      startPrice: first.price,
      endPrice: last.price,
      startRecordedAt: first.recordedAt,
      endRecordedAt: last.recordedAt,
      fires: true,
      reason: `Price trending up: ${evidence}`,
    };
  }
  return {
    ...base,
    changePct,
    slopePerDay,
    points: windowPoints.length,
    startPrice: first.price,
    endPrice: last.price,
    startRecordedAt: first.recordedAt,
    endRecordedAt: last.recordedAt,
    fires: false,
    reason: `No sustained trend: ${evidence}`,
  };
}

// ---------------------------------------------------------------------------
// #63 — Wishlist triggers
// ---------------------------------------------------------------------------

export type WishlistTriggerKind = 'price_drop' | 'back_in_stock' | 'significant_drop';

export interface WishlistTrigger {
  kind: WishlistTriggerKind;
  /** Stable dedupe key: same user + product + kind + trigger value never queues twice. */
  triggerKey: string;
  /** Price that identifies this trigger event (for per-price dedupe wording). */
  triggerPrice: number | null;
  /** Transition timestamp for back_in_stock (null otherwise). */
  transitionAt: string | null;
  /** Human evidence, always tied to the recorded numbers. */
  evidence: string;
}

export interface WishlistItemSnapshot {
  productId: string;
  /** The item's own recorded target price (null = no target set). */
  targetPrice: number | null;
  /** Latest recorded price, or null when none is recorded. */
  currentPrice: number | null;
  /** Recorded price history (any order). */
  history: FakeSalePoint[];
  /** Whether the product is in stock now (informational; the trigger is the transition). */
  inStock: boolean;
  /** Recorded out→in transition timestamp, or null when no transition was recorded. */
  transitionAt: string | null;
}

/**
 * Evaluate every wishlist trigger for one item. Returns all
 * triggers that fire (an item can fire more than one kind at
 * once — e.g. a target hit that is also a significant drop).
 * No trigger fires without its recorded evidence:
 * - price_drop: current price at/below the item's target.
 * - back_in_stock: ONLY on a recorded out→in transition
 *   (transitionAt present) — merely being in stock never fires.
 * - significant_drop: reuses #61 (≥10% vs the previous point).
 */
export function evaluateWishlistItemTriggers(
  item: WishlistItemSnapshot
): WishlistTrigger[] {
  const triggers: WishlistTrigger[] = [];

  if (
    item.targetPrice !== null &&
    Number.isFinite(item.targetPrice) &&
    item.currentPrice !== null &&
    item.currentPrice <= item.targetPrice
  ) {
    triggers.push({
      kind: 'price_drop',
      triggerKey: `wishlist:price_drop:${item.productId}:${item.currentPrice}`,
      triggerPrice: item.currentPrice,
      transitionAt: null,
      evidence:
        `Wishlisted item is now ${money(item.currentPrice)} — at or below your target of ${money(item.targetPrice)}.`,
    });
  }

  if (item.transitionAt !== null) {
    triggers.push({
      kind: 'back_in_stock',
      triggerKey: `wishlist:back_in_stock:${item.productId}:${item.transitionAt}`,
      triggerPrice: item.currentPrice,
      transitionAt: item.transitionAt,
      evidence:
        `Wishlisted item came back in stock (recorded out-of-stock → in-stock transition at ${item.transitionAt}).`,
    });
  }

  const drop = evaluateSignificantDrop(item.history, WISHLIST_DROP_THRESHOLD_PCT);
  if (drop.fires && drop.newPrice !== null) {
    triggers.push({
      kind: 'significant_drop',
      triggerKey: `wishlist:significant_drop:${item.productId}:${drop.newPrice}`,
      triggerPrice: drop.newPrice,
      transitionAt: null,
      evidence: `Wishlisted item: ${drop.reason}`,
    });
  }

  return triggers;
}

// ---------------------------------------------------------------------------
// #64 — Opportunity alert (Phase 2 composite, reused)
// ---------------------------------------------------------------------------

export interface OpportunityAlertEvaluation {
  fires: boolean;
  /** Composite evidence, only when qualified. */
  evidence: string | null;
  /** Unmet conditions (empty when qualified). */
  missing: string[];
}

/**
 * Thin wrapper over Phase 2's `evaluateBuyingOpportunity` —
 * the conditions are NOT re-implemented here. The alert fires
 * only when the composite qualifies (near recorded low + fresh
 * + validated discount + in stock).
 */
export function evaluateOpportunityAlert(
  input: BuyingOpportunityInput
): OpportunityAlertEvaluation {
  const result = evaluateBuyingOpportunity(input);
  return {
    fires: result.qualifies,
    evidence: result.evidence,
    missing: result.missing,
  };
}
