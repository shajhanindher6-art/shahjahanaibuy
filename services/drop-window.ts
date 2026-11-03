/**
 * Price Drop Window & Confidence Simulator (Option 10, Feature 2).
 *
 * EXTENDS the Option 7 Buy-vs-Wait engine — it does not replace it and
 * does not build a second prediction engine. Drop velocity is computed
 * ONLY from the product's real recorded price_history points (consecutive
 * decreases), and confidence/seasonality inherit the Buy-vs-Wait rules:
 * thin history (<= 4 points) caps confidence at 25%, and seasonal claims
 * need >= 12 points spanning >= 90 days. The whole output is labeled
 * SIMULATION in the UI: a simulated window is a range derived from past
 * velocity, never a forecast, never a guarantee, and never an exact
 * future price.
 */

import {
  predictBuyVsWait,
  THIN_HISTORY_MAX_POINTS,
  type BuyWaitPoint,
} from './buy-wait-prediction';

export interface DropWindowSimulation {
  /** 'not_enough_data' | 'no_drops' | 'simulated' — nothing else. */
  status: 'not_enough_data' | 'no_drops' | 'simulated';
  /** Average drop size in percent across real consecutive decreases. */
  avgDropPct: number | null;
  /** Average days between real consecutive drops (null with < 2 drops). */
  avgDaysBetweenDrops: number | null;
  /** Simulated window in days, as a [min, max] range — never a single date. */
  windowDays: [number, number] | null;
  /** Simulated target price range in USD, as [low, high] — never one price. */
  simulatedTargetRangeUsd: [number, number] | null;
  /** Confidence inherited from predictBuyVsWait (0-85, thin-capped). */
  confidence: number;
  lowConfidence: boolean;
  seasonalSupported: boolean;
  pointCount: number;
  dropCount: number;
  reason: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Computes the simulated drop window from real recorded points.
 * - < 2 points → not_enough_data (no verdict, no %, no window).
 * - >= 2 points but 0 drops → no_drops (no window can be simulated).
 * - >= 1 drop → velocity size; the day-window needs >= 2 drops, so a
 *   single drop yields size only and an explicit "interval unavailable".
 */
export function simulateDropWindow(points: BuyWaitPoint[]): DropWindowSimulation {
  const prediction = predictBuyVsWait(points);
  const base = {
    confidence: prediction.confidence,
    lowConfidence: prediction.lowConfidence,
    seasonalSupported: prediction.seasonalSupported,
    pointCount: prediction.pointCount,
  };

  if (prediction.recommendation === 'not_enough_data' || points.length < 2) {
    return {
      ...base,
      status: 'not_enough_data',
      avgDropPct: null,
      avgDaysBetweenDrops: null,
      windowDays: null,
      simulatedTargetRangeUsd: null,
      dropCount: 0,
      reason: 'Not enough price history to simulate — at least 2 recorded points are required.',
    };
  }

  const sorted = [...points]
    .map((p) => ({ price: Number(p.price), t: new Date(p.recordedAt).getTime() }))
    .filter((p) => Number.isFinite(p.price) && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  const drops: { pct: number; t: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.price < prev.price && prev.price > 0) {
      drops.push({ pct: ((prev.price - cur.price) / prev.price) * 100, t: cur.t });
    }
  }

  if (drops.length === 0) {
    return {
      ...base,
      status: 'no_drops',
      avgDropPct: null,
      avgDaysBetweenDrops: null,
      windowDays: null,
      simulatedTargetRangeUsd: null,
      dropCount: 0,
      reason: 'No price drops recorded yet — no drop window can be simulated from this history.',
    };
  }

  const avgDropPct = round2(drops.reduce((s, d) => s + d.pct, 0) / drops.length);
  let avgDays: number | null = null;
  if (drops.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < drops.length; i++) {
      gaps.push((drops[i].t - drops[i - 1].t) / 86400000);
    }
    avgDays = round2(gaps.reduce((s, g) => s + g, 0) / gaps.length);
  }

  const current = sorted[sorted.length - 1].price;
  // Window = interval ±50%, rounded to whole days, min 1 day. Size-only
  // when the interval is unknown (single drop): no window is claimed.
  const windowDays: [number, number] | null =
    avgDays !== null
      ? [Math.max(1, Math.round(avgDays * 0.5)), Math.max(1, Math.round(avgDays * 1.5))]
      : null;
  // Target range = current price reduced by avgDropPct ±25% of that drop.
  const lo = round2(current * (1 - (avgDropPct * 1.25) / 100));
  const hi = round2(current * (1 - (avgDropPct * 0.75) / 100));
  const targetRange: [number, number] = [Math.min(lo, hi), Math.max(lo, hi)];

  return {
    ...base,
    status: 'simulated',
    avgDropPct,
    avgDaysBetweenDrops: avgDays,
    windowDays,
    simulatedTargetRangeUsd: targetRange,
    dropCount: drops.length,
    reason:
      avgDays === null
        ? `Only ${drops.length} drop recorded — drop size is known, but the interval between drops is not, so no day-window is claimed.`
        : `Past velocity: ${drops.length} recorded drop(s) averaging ${avgDropPct}% every ~${avgDays} days. If that velocity continued, a similar drop could fall inside the window below.`,
  };
}

export { THIN_HISTORY_MAX_POINTS };
