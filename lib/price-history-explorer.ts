/**
 * Price History Explorer — pure helpers for /tools/price-history
 * (Section 13, Chunk B).
 *
 * All 10 products' recorded histories side by side: biggest %
 * drop, now vs 30-day low / high / average, sortable, shareable.
 *
 * Honesty rules (same as lib/price-trend.ts — this module only
 * composes it, it never invents points):
 * - Stats come ONLY from recorded `price_history` points. The live
 *   seed has 4 recorded points per product (30 days, Amazon only);
 *   every summary carries its pointCount and the page labels it.
 * - Never smooth or interpolate: no moving average, no filled-in
 *   days, no guessed points between recordings.
 * - A product with no recorded history gets stats null and an
 *   honest empty state — never a zero-filled row.
 */

import {
  computePriceDrops,
  computeTrendStats,
  type PriceDrop,
  type TrendPoint,
  type TrendStats,
} from '@/lib/price-trend';
import { assessHistoryGate } from '@/lib/price-history-gates';

export type ExplorerSort = 'biggest-drop' | 'lowest-price' | 'current-price' | 'name';

export const EXPLORER_SORTS: ExplorerSort[] = [
  'biggest-drop',
  'lowest-price',
  'current-price',
  'name',
];

export const EXPLORER_SORT_LABELS: Record<ExplorerSort, string> = {
  'biggest-drop': 'Biggest % drop first',
  'lowest-price': 'Lowest recorded price first',
  'current-price': 'Lowest current price first',
  name: 'Name A–Z',
};

/** Label shown wherever a summary's thin history must be visible. */
export function explorerPointLabel(pointCount: number): string {
  return `${pointCount} recorded point${pointCount === 1 ? '' : 's'}`;
}

export interface ProductHistorySummary {
  productId: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  /** Recorded points, oldest-first, exactly as recorded. */
  points: TrendPoint[];
  pointCount: number;
  /** Null when the product has no recorded history. */
  stats: TrendStats | null;
  /** All recorded point-to-point drops, newest last. */
  drops: PriceDrop[];
  /** Largest single recorded drop, or null when none recorded. */
  biggestDrop: PriceDrop | null;
  /**
   * FINAL 100% (W3, F-P1-36) — why the summary is gated, when it
   * is: the unified 5-point + freshness gate reason. A gated
   * summary keeps stats AND biggestDrop null — the live seed's
   * identical −2.86% "biggest drop" on all 10 products was a
   * seed-constructed step (×1.05 → ×1.02) presented as each
   * product's biggest real price drop. Null when ungated.
   */
  gateReason: string | null;
  /** Whole days since the latest recorded point (null when unknown). */
  ageDays: number | null;
}

/**
 * Build one product's summary from its recorded points (any order
 * in, oldest-first out). Invalid points are dropped by the trend
 * helpers, never treated as zero. The summary is gated by the
 * unified 5-point + freshness rule (lib/price-history-gates.ts):
 * below 5 points, or with a stale latest point, stats and
 * biggestDrop are null and gateReason says why — the raw points
 * and the drop list are still returned, so the page can show the
 * recorded points themselves while withholding the interpretive
 * verdicts drawn from them.
 */
export function buildProductHistorySummary(
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
  },
  history: TrendPoint[],
  now: Date = new Date()
): ProductHistorySummary {
  const points = [...history]
    .filter(
      (p) =>
        Number.isFinite(p.price) &&
        p.recordedAt &&
        Number.isFinite(new Date(p.recordedAt).getTime())
    )
    .sort(
      (a, b) =>
        new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
    );
  const gate = assessHistoryGate(points, now);
  const stats = gate.gated ? null : computeTrendStats(points);
  const drops = computePriceDrops(points);
  const biggestDrop =
    gate.gated || drops.length === 0
      ? null
      : drops.reduce((best, d) => (d.dropPercent > best.dropPercent ? d : best), drops[0]);
  return {
    productId: product.id,
    name: product.name,
    slug: product.slug,
    brand: product.brand,
    category: product.category,
    points,
    pointCount: points.length,
    stats,
    drops,
    biggestDrop,
    gateReason: gate.gated ? gate.reason : null,
    ageDays: gate.ageDays,
  };
}

/** Sort summaries; products without the sort key sort last. */
export function sortHistorySummaries(
  summaries: ProductHistorySummary[],
  sortBy: ExplorerSort
): ProductHistorySummary[] {
  const sorted = [...summaries];
  switch (sortBy) {
    case 'biggest-drop':
      sorted.sort((a, b) => {
        const ad = a.biggestDrop?.dropPercent ?? -1;
        const bd = b.biggestDrop?.dropPercent ?? -1;
        if (bd !== ad) return bd - ad;
        return a.name.localeCompare(b.name);
      });
      break;
    case 'lowest-price':
      sorted.sort((a, b) => {
        const al = a.stats?.lowest ?? Number.POSITIVE_INFINITY;
        const bl = b.stats?.lowest ?? Number.POSITIVE_INFINITY;
        if (al !== bl) return al - bl;
        return a.name.localeCompare(b.name);
      });
      break;
    case 'current-price':
      sorted.sort((a, b) => {
        const ac = a.stats?.current ?? Number.POSITIVE_INFINITY;
        const bc = b.stats?.current ?? Number.POSITIVE_INFINITY;
        if (ac !== bc) return ac - bc;
        return a.name.localeCompare(b.name);
      });
      break;
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }
  return sorted;
}

/** Parse ?sort=… from the page's search params; unknown → default. */
export function parseExplorerSort(
  searchParams: { sort?: string | string[] } | undefined
): ExplorerSort {
  const rawSort = searchParams?.sort;
  const raw = Array.isArray(rawSort) ? rawSort[0] : rawSort;
  return (EXPLORER_SORTS as string[]).includes(raw ?? '')
    ? (raw as ExplorerSort)
    : 'biggest-drop';
}
