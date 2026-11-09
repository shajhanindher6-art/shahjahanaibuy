/**
 * Deal Fake-ness & Inflation Checker — Option 15 (market-gap batch).
 *
 * PURE function: same history in → same result out. No network, no
 * scraping, no LLM, no judgment about any retailer's intent.
 *
 * Two pattern checks over the 30 days before the latest recorded price:
 *  (1) Fake-discount pattern — reuses services/fake-sale.ts
 *      detectFakeSale (rise >= 10% in window + subsequent drop +
 *      latest NOT below the pre-rise price). Its rules are NOT
 *      reimplemented here; they are imported.
 *  (2) Sustained inflation — NEW signal the fake-sale detector does
 *      not cover: the price crept up >= 10% from the window's earliest
 *      price and is still at/near the window maximum (no meaningful
 *      drop since). A slow upward creep with no drop.
 *
 * WORDING: verdicts are PATTERN flags ("pattern detected"), never scam
 * or fraud accusations — intent cannot be read from a price series.
 */

import {
  detectFakeSale,
  FAKE_SALE_WINDOW_DAYS,
  FAKE_SALE_MIN_RISE,
} from './fake-sale';

export type InflationVerdict =
  | 'fake_discount_pattern'
  | 'inflated'
  | 'no_pattern'
  | 'insufficient';

export interface InflationPoint {
  price: number;
  /** ISO timestamp of the recording. */
  recordedAt: string;
}

export interface InflationCheckResult {
  verdict: InflationVerdict;
  /** Factual explanation, always tied to the real recorded numbers. */
  reason: string;
  /** Rise as a fraction, e.g. 0.15 for +15%, or null when undetermined. */
  risePct: number | null;
  /** Drop from the window peak to the current price, as a fraction. */
  dropPct: number | null;
  /** Oldest recorded price inside the 30-day window, or null. */
  earliestPrice: number | null;
  /** Highest recorded price inside the 30-day window, or null. */
  peakPrice: number | null;
  /** Latest recorded price, or null when no usable points. */
  currentPrice: number | null;
  /** Valid recorded points inside the 30-day window. */
  pointCount: number;
  /** Days between the earliest and latest window points. */
  spanDays: number;
}

/** Stated thresholds — change them here and the UI text follows. */
export const INFLATION_WINDOW_DAYS = FAKE_SALE_WINDOW_DAYS; // 30
export const INFLATION_MIN_RISE = FAKE_SALE_MIN_RISE; // 0.10 (10%)
/** Current price at/above this share of the window peak = "near the max". */
export const INFLATION_NEAR_MAX_TOLERANCE = 0.98;
/** Guards the >= comparisons against float dust (e.g. 100 * 1.1). */
const EPS = 1e-9;

const DAY_MS = 24 * 60 * 60 * 1000;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function checkPriceInflation(points: InflationPoint[]): InflationCheckResult {
  const base: InflationCheckResult = {
    verdict: 'insufficient',
    reason: 'Not enough price history to check — need at least 2 recorded prices.',
    risePct: null,
    dropPct: null,
    earliestPrice: null,
    peakPrice: null,
    currentPrice: null,
    pointCount: 0,
    spanDays: 0,
  };

  // Usable points only, oldest first. Invalid prices/dates are dropped,
  // never treated as zero (a zero would fabricate a rise).
  const usable = points
    .map((p) => ({ price: p.price, time: new Date(p.recordedAt).getTime() }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
  if (usable.length < 2) return base;

  const latest = usable[usable.length - 1];
  const windowStart = latest.time - INFLATION_WINDOW_DAYS * DAY_MS;
  const windowPoints = usable.filter((p) => p.time >= windowStart);
  // The checks below are window checks: fewer than 2 points inside the
  // 30-day window means the window cannot be judged.
  if (windowPoints.length < 2) {
    return {
      ...base,
      reason:
        'Not enough price history in the last 30 days to check — need at least 2 recorded prices.',
    };
  }

  const earliest = windowPoints[0];
  let peak = windowPoints[0];
  for (const p of windowPoints) if (p.price > peak.price) peak = p;

  const earliestPrice = round2(earliest.price);
  const peakPrice = round2(peak.price);
  const currentPrice = round2(latest.price);
  const pointCount = windowPoints.length;
  const spanDays = Math.max(
    0,
    Math.round((latest.time - earliest.time) / DAY_MS)
  );
  const dropPct = round3((peak.price - latest.price) / peak.price);

  const shared = {
    earliestPrice,
    peakPrice,
    currentPrice,
    pointCount,
    spanDays,
    dropPct,
  };

  // (1) Fake-discount pattern — delegated to the existing detector.
  const fakeSale = detectFakeSale(points);
  if (fakeSale.alert && fakeSale.risePct !== null) {
    const risePct = round3(fakeSale.risePct);
    return {
      ...shared,
      verdict: 'fake_discount_pattern',
      reason:
        `Fake-discount pattern detected in the last ${INFLATION_WINDOW_DAYS} days: ` +
        `price rose from ${money(fakeSale.preRisePrice ?? earliest.price)} to ` +
        `${money(fakeSale.peakPrice ?? peak.price)} (+${Math.round(risePct * 100)}%), ` +
        `then dropped to ${money(latest.price)} — the "discount" is vs the raised ` +
        `price, not the pre-rise price. Pattern flag only, not an accusation ` +
        `about any seller.`,
      risePct,
    };
  }

  // (2) Sustained inflation — slow upward creep, still at/near the max.
  const windowRise = (latest.price - earliest.price) / earliest.price;
  const nearMax = latest.price >= peak.price * INFLATION_NEAR_MAX_TOLERANCE - EPS;
  if (windowRise >= INFLATION_MIN_RISE - EPS && nearMax) {
    return {
      ...shared,
      verdict: 'inflated',
      reason:
        `Sustained price inflation in the last ${INFLATION_WINDOW_DAYS} days: ` +
        `price rose from ${money(earliest.price)} to ${money(latest.price)} ` +
        `(+${Math.round(windowRise * 100)}%) with no meaningful drop since — ` +
        `the current price is at/near its 30-day maximum. Pattern flag only, ` +
        `not an accusation about any seller.`,
      risePct: round3(windowRise),
    };
  }

  // (3) No pattern.
  const risePct = round3(windowRise);
  const pctText =
    windowRise >= 0
      ? `+${Math.round(windowRise * 100)}%`
      : `${Math.round(windowRise * 100)}%`;
  return {
    ...shared,
    verdict: 'no_pattern',
    reason:
      `No fake-discount or inflation pattern detected in the last ` +
      `${INFLATION_WINDOW_DAYS} days: price moved from ${money(earliest.price)} ` +
      `to ${money(latest.price)} (${pctText}) across ${pointCount} recorded prices.`,
    risePct,
  };
}
