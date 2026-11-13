/**
 * Price Volatility Ranking — pure helpers for /tools/volatility-ranking
 * (Section 16, E1).
 *
 * Ranks products by price stability from RECORDED price_history
 * points only: standard deviation / mean (coefficient of variation)
 * and the high–low range %. Never smoothed, never interpolated, no
 * invented points. A product needs at least 2 recorded points for
 * a dispersion metric to mean anything — with fewer it gets stats
 * null and an honest "not enough recorded points" row, never a
 * zero-filled volatility.
 *
 * FINAL 100% (W3, F-P1-36) — the 2-point minimum was not enough:
 * the live seed's 4 points per product all carry the same
 * ×1.05/×1.02/×1.00/×1.00 shape, so every product ranked "Stable"
 * at ~2.1% CV with the order decided by the name tie-break — a
 * seed-constructed ranking presented as a stability ranking.
 * Ranking now shares the unified gate (lib/price-history-gates.ts):
 * at least 5 recorded points AND a fresh latest point. A gated
 * row keeps stats null and carries gateReason, so the page says
 * WHY it is unranked instead of silently dropping it.
 *
 * This is NOT the Price History Explorer: that tool shows levels
 * (low/high/average/biggest drop); this one measures dispersion
 * (how much the price moved around its own mean).
 */

import { assessHistoryGate, HISTORY_MIN_POINTS } from '@/lib/price-history-gates';

export { HISTORY_MIN_POINTS as VOLATILITY_MIN_POINTS };

export interface VolatilityPoint {
  price: number;
  recordedAt: string;
  /** Migration 057 source, when recorded (null pre-057). */
  source?: string | null;
}

export type VolatilitySort = 'most-stable' | 'most-volatile' | 'name';

export const VOLATILITY_SORTS: VolatilitySort[] = [
  'most-stable',
  'most-volatile',
  'name',
];

export const VOLATILITY_SORT_LABELS: Record<VolatilitySort, string> = {
  'most-stable': 'Most stable first',
  'most-volatile': 'Most volatile first',
  name: 'Name A–Z',
};

/** Stability label from the coefficient of variation (std-dev/mean). */
export function stabilityLabel(coefficientOfVariationPercent: number): string {
  if (coefficientOfVariationPercent < 1) return 'Very stable';
  if (coefficientOfVariationPercent < 3) return 'Stable';
  if (coefficientOfVariationPercent < 8) return 'Moderately volatile';
  return 'Volatile';
}

export interface VolatilityStats {
  /** Arithmetic mean of the recorded prices. */
  mean: number;
  /** Population standard deviation of the recorded prices. */
  stdDev: number;
  /** stdDev / mean × 100 — the ranking metric. */
  coefficientOfVariationPercent: number;
  lowest: number;
  highest: number;
  /**
   * (highest − lowest) / lowest × 100 — the recorded range as a
   * percentage of the lowest recorded price.
   */
  rangePercent: number;
  label: string;
}

/**
 * Dispersion stats from recorded points, or null when fewer than
 * 2 valid points exist. Invalid prices are dropped, never treated
 * as zero.
 */
export function computeVolatility(
  points: ReadonlyArray<VolatilityPoint | null | undefined>
): VolatilityStats | null {
  const prices = (points ?? [])
    .map((p) => (p ? Number(p.price) : Number.NaN))
    .filter((p) => Number.isFinite(p));
  if (prices.length < 2) return null;
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  if (!Number.isFinite(mean) || mean <= 0) return null;
  const variance =
    prices.reduce((acc, p) => acc + (p - mean) * (p - mean), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  const coefficientOfVariationPercent = (stdDev / mean) * 100;
  return {
    mean,
    stdDev,
    coefficientOfVariationPercent,
    lowest,
    highest,
    rangePercent: ((highest - lowest) / lowest) * 100,
    label: stabilityLabel(coefficientOfVariationPercent),
  };
}

export interface VolatilityRow {
  productId: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  pointCount: number;
  /** Null when fewer than 2 recorded points exist. */
  stats: VolatilityStats | null;
  /** 1-based rank by stability (1 = most stable); null when unranked. */
  rank: number | null;
  /**
   * FINAL 100% (W3, F-P1-36) — why the row is unranked, when it
   * is: the unified 5-point + freshness gate reason. Null when
   * the row cleared the gate (stats present).
   */
  gateReason: string | null;
  /** Whole days since the latest recorded point (null when unknown). */
  ageDays: number | null;
}

/** One product's volatility row from its recorded points. */
export function buildVolatilityRow(
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
  },
  points: ReadonlyArray<VolatilityPoint | null | undefined>,
  now: Date = new Date()
): VolatilityRow {
  const valid = (points ?? []).filter(
    (p): p is VolatilityPoint =>
      !!p && Number.isFinite(Number(p.price)) && !!p.recordedAt
  );
  // FINAL 100% (W3, F-P1-36) — unified gate: 5 recorded points
  // AND a fresh latest point. computeVolatility's own 2-point
  // floor still applies underneath (a gated row never reaches it).
  const gate = assessHistoryGate(valid, now);
  return {
    productId: product.id,
    name: product.name,
    slug: product.slug,
    brand: product.brand,
    category: product.category,
    pointCount: valid.length,
    stats: gate.gated ? null : computeVolatility(valid),
    rank: null,
    gateReason: gate.gated ? gate.reason : null,
    ageDays: gate.ageDays,
  };
}

/**
 * Sort rows and assign stability ranks (1 = most stable). Rows
 * without stats sort last and stay unranked. Ties break by name.
 */
export function sortVolatilityRows(
  rows: VolatilityRow[],
  sortBy: VolatilitySort
): VolatilityRow[] {
  const sorted = [...rows];
  switch (sortBy) {
    case 'most-stable':
      sorted.sort((a, b) => {
        const av = a.stats?.coefficientOfVariationPercent;
        const bv = b.stats?.coefficientOfVariationPercent;
        if (av === undefined && bv === undefined) return a.name.localeCompare(b.name);
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        if (av !== bv) return av - bv;
        return a.name.localeCompare(b.name);
      });
      break;
    case 'most-volatile':
      sorted.sort((a, b) => {
        const av = a.stats?.coefficientOfVariationPercent;
        const bv = b.stats?.coefficientOfVariationPercent;
        if (av === undefined && bv === undefined) return a.name.localeCompare(b.name);
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        if (av !== bv) return bv - av;
        return a.name.localeCompare(b.name);
      });
      break;
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }
  if (sortBy === 'most-stable' || sortBy === 'most-volatile') {
    let rank = 0;
    for (const row of sorted) {
      row.rank = row.stats ? ++rank : null;
    }
  }
  return sorted;
}

/** Parse ?sort=… from the page's search params; unknown → default. */
export function parseVolatilitySort(
  searchParams: { sort?: string | string[] } | undefined
): VolatilitySort {
  const rawSort = searchParams?.sort;
  const raw = Array.isArray(rawSort) ? rawSort[0] : rawSort;
  return (VOLATILITY_SORTS as string[]).includes(raw ?? '')
    ? (raw as VolatilitySort)
    : 'most-stable';
}

/** Label shown on every row so the thin history stays visible. */
export function volatilityPointLabel(pointCount: number): string {
  return `from ${pointCount} recorded point${pointCount === 1 ? '' : 's'}`;
}
