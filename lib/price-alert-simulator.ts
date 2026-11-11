/**
 * Price Alert Simulator — pure helpers for /tools/price-alert-simulator
 * (Section 14, Chunk 2).
 *
 * The user picks a product and a target price; the simulator answers
 * what a price-drop alert set at that target would do, judged ONLY
 * against the RECORDED price history (currently 4 points per
 * product over 30 days, Amazon only).
 *
 * Honesty rules:
 * - Never smooth or interpolate, never predict a probability or a
 *   date. There is no "likely to hit" claim here: with 4 recorded
 *   points no probability is defensible, and the Deal Score is
 *   100/100 for every product today, so nothing here claims one
 *   product is more likely to drop than another.
 * - The verdict is only about the recorded past: the target was
 *   already met (current price is at or below it), has been
 *   recorded before (at or above the recorded low), has never been
 *   recorded (below the recorded low), or cannot be judged (no
 *   recorded history).
 * - This is a simulation only — it creates NO real price alert.
 */

import {
  computeTrendStats,
  type TrendPoint,
} from '@/lib/price-trend';

export type AlertVerdict =
  | 'already-met'
  | 'recorded-before'
  | 'below-recorded-low'
  | 'cannot-verify';

export const ALERT_VERDICT_LABELS: Record<AlertVerdict, string> = {
  'already-met': 'Already met — the alert would fire now',
  'recorded-before': 'Recorded before — this price has been seen',
  'below-recorded-low': 'Never recorded — below every recorded price',
  'cannot-verify': 'Cannot verify — no recorded price history',
};

export interface AlertSimulation {
  target: number;
  current: number;
  lowest: number;
  highest: number;
  pointCount: number;
  /** Current price minus target; 0 when already met. */
  dropNeededAmount: number;
  /** Drop needed as % of the current price; 0 when already met. */
  dropNeededPercent: number;
  verdict: AlertVerdict;
}

/**
 * Simulate an alert at `target` against recorded points (any order
 * in, sorted oldest-first internally by the trend helpers).
 * Returns null for a non-positive target, or when there is no
 * recorded history to judge against (verdict 'cannot-verify' is
 * returned instead as a full result only when points exist but are
 * empty — see below).
 */
export function simulatePriceAlert(
  target: number,
  points: TrendPoint[]
): AlertSimulation | null {
  if (!Number.isFinite(target) || target <= 0) return null;
  const stats = computeTrendStats(
    [...points]
      .filter(
        (p) =>
          Number.isFinite(p.price) &&
          p.recordedAt &&
          Number.isFinite(new Date(p.recordedAt).getTime())
      )
      .sort(
        (a, b) =>
          new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
      )
  );
  if (stats === null) {
    return {
      target,
      current: NaN,
      lowest: NaN,
      highest: NaN,
      pointCount: 0,
      dropNeededAmount: NaN,
      dropNeededPercent: NaN,
      verdict: 'cannot-verify',
    };
  }
  const dropNeededAmount = Math.max(0, stats.current - target);
  const verdict: AlertVerdict =
    stats.current <= target
      ? 'already-met'
      : target >= stats.lowest
        ? 'recorded-before'
        : 'below-recorded-low';
  return {
    target,
    current: stats.current,
    lowest: stats.lowest,
    highest: stats.highest,
    pointCount: stats.pointCount,
    dropNeededAmount: Math.round(dropNeededAmount * 100) / 100,
    dropNeededPercent:
      stats.current > 0
        ? Math.round(((dropNeededAmount / stats.current) * 100) * 10) / 10
        : 0,
    verdict,
  };
}

/** Parse the page's GET params: ?product=…&target=…. */
export function parseAlertSimulatorParams(searchParams: {
  product?: string | string[];
  target?: string | string[];
}): {
  productId: string | null;
  target: number | null;
  targetError: string | null;
} {
  const rawProduct = Array.isArray(searchParams.product)
    ? searchParams.product[0]
    : searchParams.product;
  const rawTarget = Array.isArray(searchParams.target)
    ? searchParams.target[0]
    : searchParams.target;

  let target: number | null = null;
  let targetError: string | null = null;
  if (rawTarget !== undefined && rawTarget.trim().length > 0) {
    const parsed = Number(rawTarget.replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      targetError = `"${rawTarget}" is not a valid target price — enter a positive number.`;
    } else {
      target = parsed;
    }
  }

  return {
    productId:
      rawProduct !== undefined && rawProduct.trim().length > 0
        ? rawProduct.trim()
        : null,
    target,
    targetError,
  };
}
