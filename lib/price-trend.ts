/**
 * Pure price-trend analytics — computed ONLY from actual recorded
 * `price_history` points. No interpolation, no synthesized points, no
 * invented "past months" curve. If the data is thin (the live seed has
 * ~4 points per product), the stats say so: ranges report how many
 * recorded points they actually contain, and an empty drop list is an
 * honest empty state, not a zero-filled series.
 */

export interface TrendPoint {
  price: number;
  recordedAt: string;
}

export interface PriceDrop {
  /** ISO date of the newer (lower) point. */
  date: string;
  oldPrice: number;
  newPrice: number;
  dropAmount: number;
  dropPercent: number;
}

export interface TrendStats {
  current: number;
  lowest: number;
  highest: number;
  average: number;
  /** Current minus lowest — how far above the best recorded price we are. */
  vsLowestAmount: number;
  vsLowestPercent: number;
  /** First minus last change across the range (kept for parity with the chart). */
  change: number;
  changePercent: number;
  pointCount: number;
}

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Filter points to a range window. `days === null` means ALL recorded
 * history (no cutoff) — the range the old 7D/30D/90D/1Y selector lacked,
 * and the only range guaranteed to show every recorded point.
 * Points are returned oldest-first, invalid rows dropped.
 */
export function filterPointsByRange(points: TrendPoint[], days: number | null, nowMs: number = Date.now()): TrendPoint[] {
  const valid = points
    .filter((p) => Number.isFinite(p.price) && p.recordedAt && Number.isFinite(toMs(p.recordedAt)))
    .sort((a, b) => toMs(a.recordedAt) - toMs(b.recordedAt));
  if (days === null) return valid;
  const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
  return valid.filter((p) => toMs(p.recordedAt) >= cutoff);
}

/** Stats over range-filtered points, or null when the range is empty. */
export function computeTrendStats(points: TrendPoint[]): TrendStats | null {
  if (points.length === 0) return null;
  const prices = points.map((p) => p.price);
  const current = prices[prices.length - 1];
  const first = prices[0];
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  const average = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const change = current - first;
  return {
    current,
    lowest,
    highest,
    average,
    vsLowestAmount: current - lowest,
    vsLowestPercent: lowest !== 0 ? ((current - lowest) / lowest) * 100 : 0,
    change,
    changePercent: first !== 0 ? (change / first) * 100 : 0,
    pointCount: points.length,
  };
}

/**
 * Real point-to-point price decreases: consecutive recorded points
 * (oldest-first) where the newer price is strictly lower. Each drop
 * carries the date of the lower point, old → new, and drop %.
 * A series with no decreases returns [] — callers render "No price
 * drops recorded in this range", never a fabricated drop.
 */
export function computePriceDrops(pointsOldestFirst: TrendPoint[]): PriceDrop[] {
  const drops: PriceDrop[] = [];
  for (let i = 1; i < pointsOldestFirst.length; i++) {
    const prev = pointsOldestFirst[i - 1];
    const curr = pointsOldestFirst[i];
    if (curr.price < prev.price && prev.price > 0) {
      drops.push({
        date: curr.recordedAt,
        oldPrice: prev.price,
        newPrice: curr.price,
        dropAmount: prev.price - curr.price,
        dropPercent: ((prev.price - curr.price) / prev.price) * 100,
      });
    }
  }
  return drops;
}
