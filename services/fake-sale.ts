/**
 * Fake Sale detector — Option 11, Phase 2 (AI Trust & Protection Layer).
 *
 * PURE function: same history in → same result out. No network, no
 * scraping, no judgment about any retailer's intent.
 *
 * APPROVED RULE (user-confirmed 2026-11-05, thresholds stated here):
 * - Look at ONE retailer's price history, anchored at its latest
 *   recorded price (the "sale" price being checked).
 * - Window: the 30 days before that latest point. Both the pre-rise
 *   price and the peak must fall inside the window — a rise that
 *   started earlier does not count.
 * - Alert ONLY when all three hold:
 *   (1) a rise of 10% or more from a pre-rise low to a peak,
 *   (2) the price then dropped from that peak to the latest price,
 *   (3) the latest price is NOT below the pre-rise price — so the
 *       "discount" is only vs the raised price, not vs the price
 *       shoppers actually saw before the rise.
 * - Wording is strictly factual: "price was raised just before this
 *   sale — discount is vs the raised price". It never claims the
 *   retailer acted deceptively, raised the price deliberately, or
 *   ran a fake sale — intent cannot be read from a price series.
 *
 * NEGATIVE TEST (must keep passing): the MacBook history
 * ($1,018.98 → $999.00, a drop with no prior rise) yields NO alert.
 * If it ever alerts, this rule is wrong, not the data.
 *
 * HONEST LIMITS:
 * - Fewer than 2 points in the window → "not enough history", never
 *   a clean bill: absence of evidence is not evidence of absence.
 * - A retailer with no history at all is reported as unchecked, never
 *   as clean.
 */

export interface FakeSalePoint {
  price: number;
  /** ISO timestamp of the recording. */
  recordedAt: string;
}

export interface FakeSaleResult {
  /** True only when rise + drop + not-below-pre-rise all hold. */
  alert: boolean;
  /** Pre-rise low inside the window, or null when not determinable. */
  preRisePrice: number | null;
  /** Peak inside the window before the latest point, or null. */
  peakPrice: number | null;
  /** Latest recorded price, or null when no usable points. */
  currentPrice: number | null;
  /** Rise as a fraction, e.g. 0.15 for +15%, or null. */
  risePct: number | null;
  windowDays: number;
  pointsInWindow: number;
  /** Factual explanation when alert is true, otherwise null. */
  explanation: string | null;
}

/** Stated thresholds — change them here and the UI text follows. */
export const FAKE_SALE_WINDOW_DAYS = 30;
export const FAKE_SALE_MIN_RISE = 0.1; // 10%

const DAY_MS = 24 * 60 * 60 * 1000;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function detectFakeSale(
  points: FakeSalePoint[],
  windowDays: number = FAKE_SALE_WINDOW_DAYS,
  minRise: number = FAKE_SALE_MIN_RISE
): FakeSaleResult {
  const base: FakeSaleResult = {
    alert: false,
    preRisePrice: null,
    peakPrice: null,
    currentPrice: null,
    risePct: null,
    windowDays,
    pointsInWindow: 0,
    explanation: null,
  };

  // Usable points only, oldest first. Invalid prices/dates are dropped,
  // never treated as zero (a zero would fabricate a rise).
  const usable = points
    .map((p) => ({ price: p.price, time: new Date(p.recordedAt).getTime() }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
  if (usable.length === 0) return base;

  const latest = usable[usable.length - 1];
  base.currentPrice = Math.round(latest.price * 100) / 100;

  const windowStart = latest.time - windowDays * DAY_MS;
  const windowPoints = usable.filter((p) => p.time >= windowStart);
  base.pointsInWindow = windowPoints.length;
  // Need at least a pre-rise point and the latest point inside the window.
  if (windowPoints.length < 2) return base;

  // Peak = highest price in the window BEFORE the latest point (the
  // drop to the latest price is part of the pattern).
  const beforeLatest = windowPoints.slice(0, -1);
  let peak = beforeLatest[0];
  for (const p of beforeLatest) if (p.price > peak.price) peak = p;
  base.peakPrice = Math.round(peak.price * 100) / 100;

  // Pre-rise low = lowest price at or before the peak, inside the window.
  let low = windowPoints[0];
  for (const p of windowPoints) {
    if (p.time > peak.time) break;
    if (p.price < low.price) low = p;
  }
  base.preRisePrice = Math.round(low.price * 100) / 100;

  const rise = (peak.price - low.price) / low.price;
  base.risePct = Math.round(rise * 1000) / 1000;

  const droppedFromPeak = latest.price < peak.price;
  const notBelowPreRise = latest.price >= low.price;
  if (rise >= minRise && droppedFromPeak && notBelowPreRise) {
    base.alert = true;
    base.explanation =
      `Price was raised just before this sale — discount is vs the raised price: ` +
      `rose from ${money(low.price)} to ${money(peak.price)} (+${Math.round(rise * 100)}% within ${windowDays} days), ` +
      `then dropped to ${money(latest.price)}, which is not below the pre-rise price. ` +
      `This describes the price pattern only, not the retailer's intent.`;
  }
  return base;
}
