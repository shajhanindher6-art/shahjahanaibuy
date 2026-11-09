/**
 * Trade-in / Resale Value Predictor — deterministic projection, no LLM, no key.
 *
 * HONESTY RULES (do not weaken them):
 * - There is NO resale transaction data and NO measured category
 *   depreciation curve in this project. The output is a PROJECTION from
 *   the product's OWN recorded price decline — never a measured category
 *   curve, never a resale quote, never a guaranteed future value.
 * - The projection is a straight line: the recorded earliest-to-latest
 *   decline, spread evenly per month, extended to 6/12/18/24 months.
 *   Retention is capped at 0..100 and the projected value is the current
 *   price times the projected retention.
 * - A projection needs at least 2 valid points spanning at least 7 days
 *   and a valid current price. Otherwise the only output is
 *   "not enough recorded price history" — no %, no curve, no value.
 * - A flat or rising recorded price projects 100% retention (decline 0),
 *   stated as such — the engine never invents depreciation.
 * - The UI must label the output "Simulated — not a resale quote or
 *   guarantee." (same honesty language as the drop-window simulator).
 */

export interface ResalePoint {
  price: number;
  recordedAt: string;
}

export interface ResaleCurvePoint {
  /** Months from now: 6, 12, 18 or 24. */
  month: number;
  /** Projected value retained at that month, whole percent, 0..100. */
  retentionPct: number;
}

export interface ResalePrediction {
  /** 'ok' | 'insufficient' — nothing else. */
  status: 'ok' | 'insufficient';
  /** Projected retention at 24 months, whole percent (null when insufficient). */
  retentionPct24: number | null;
  /** Recorded decline per month, percent, rounded to 2 decimals (null when insufficient). */
  monthlyDeclinePct: number | null;
  /** Days between the earliest and latest valid recorded points. */
  spanDays: number;
  /** Number of valid recorded points used. */
  pointCount: number;
  /** Straight-line retention curve at 6/12/18/24 months (null when insufficient). */
  curve: ResaleCurvePoint[] | null;
  /** Projected value in USD at 24 months (null when insufficient). */
  projectedValueUsd24: number | null;
  /** One-line reason, always tied to the actual recorded points. */
  reason: string;
}

/** A projection needs at least this many valid recorded points. */
export const RESALE_MIN_POINTS = 2;
/** A projection needs the recorded history to span at least this many days. */
export const RESALE_MIN_SPAN_DAYS = 7;
/** Months at which the straight-line retention curve is reported. */
export const RESALE_CURVE_MONTHS: readonly number[] = [6, 12, 18, 24];

const DAY_MS = 86_400_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function insufficient(pointCount: number, spanDays: number): ResalePrediction {
  return {
    status: 'insufficient',
    retentionPct24: null,
    monthlyDeclinePct: null,
    spanDays,
    pointCount,
    curve: null,
    projectedValueUsd24: null,
    reason: 'Not enough recorded price history to project resale value.',
  };
}

export function predictResaleValue(
  points: ResalePoint[],
  currentPriceUsd: number | null
): ResalePrediction {
  const valid = points
    .filter(
      (p) =>
        Number.isFinite(p.price) && p.price > 0 && Number.isFinite(toMs(p.recordedAt))
    )
    .map((p) => ({ price: p.price, ms: toMs(p.recordedAt) }))
    .sort((a, b) => a.ms - b.ms);

  const spanDays =
    valid.length >= 2
      ? Math.max(0, Math.round((valid[valid.length - 1].ms - valid[0].ms) / DAY_MS))
      : 0;

  if (
    valid.length < RESALE_MIN_POINTS ||
    spanDays < RESALE_MIN_SPAN_DAYS ||
    currentPriceUsd === null ||
    currentPriceUsd === undefined ||
    !Number.isFinite(currentPriceUsd) ||
    currentPriceUsd <= 0
  ) {
    return insufficient(valid.length, spanDays);
  }

  const earliest = valid[0].price;
  const latest = valid[valid.length - 1].price;
  const months = spanDays / 30;
  const totalDeclinePct = round2(((earliest - latest) / earliest) * 100);

  // Flat or rising recorded price: no decline to project — retention stays 100%.
  if (totalDeclinePct <= 0) {
    return {
      status: 'ok',
      retentionPct24: 100,
      monthlyDeclinePct: 0,
      spanDays,
      pointCount: valid.length,
      curve: RESALE_CURVE_MONTHS.map((month) => ({ month, retentionPct: 100 })),
      projectedValueUsd24: round2(currentPriceUsd),
      reason: `The recorded price did not decline over ${spanDays} days (${valid.length} recorded points, $${earliest.toFixed(2)} to $${latest.toFixed(2)}), so the projected retention stays at 100%. This is a straight-line projection from recorded history — not a resale quote or a guarantee.`,
    };
  }

  const monthlyDeclinePct = round2(totalDeclinePct / months);
  const curve: ResaleCurvePoint[] = RESALE_CURVE_MONTHS.map((month) => ({
    month,
    retentionPct: Math.min(100, Math.max(0, Math.round(100 - monthlyDeclinePct * month))),
  }));
  const retentionPct24 = curve.find((c) => c.month === 24)?.retentionPct ?? 0;

  return {
    status: 'ok',
    retentionPct24,
    monthlyDeclinePct,
    spanDays,
    pointCount: valid.length,
    curve,
    projectedValueUsd24: round2((currentPriceUsd * retentionPct24) / 100),
    reason: `Recorded price fell ${totalDeclinePct}% from $${earliest.toFixed(2)} to $${latest.toFixed(2)} over ${spanDays} days (${valid.length} recorded points), about ${monthlyDeclinePct}% per month. Projected retention is a straight-line extension of that decline — not a resale quote or a guarantee.`,
  };
}
