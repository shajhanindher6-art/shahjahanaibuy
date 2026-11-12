/**
 * Catalog Freshness / Data-Health Dashboard — pure helpers for
 * /tools/catalog-freshness (Section 16, E2).
 *
 * Public per-product transparency table: last recorded price date,
 * price age in days, history point count, and missing image/GTIN
 * flags. All values come from the products API shape
 * (dataFreshness, imageUrl, gtin) plus recorded price_history
 * points, shaped through lib/price-freshness.ts. Nothing is
 * invented: an unknown age renders as "unknown", never a guess,
 * and a product with no history shows "No recorded price history".
 */

import {
  formatLastChecked,
  getPriceAgeDays,
  isPriceStale,
  latestRecordedAt,
} from '@/lib/price-freshness';

export interface FreshnessPoint {
  recordedAt?: string | null;
}

export interface FreshnessRow {
  productId: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  /** Latest recorded price date (ISO), or null when no history. */
  lastRecordedAt: string | null;
  /** Human date for lastRecordedAt, or null when unknown. */
  lastRecordedLabel: string | null;
  /** Whole days since the last recorded price, or null when unknown. */
  ageDays: number | null;
  /** True when the last recorded price is older than STALE_PRICE_DAYS. */
  stale: boolean;
  /** Number of recorded price_history points. */
  pointCount: number;
  /** True when the product has no image URL (imageUrl null). */
  missingImage: boolean;
  /** True when the product has no GTIN (gtin null). */
  missingGtin: boolean;
  /** Recorded freshness stamp from the products table, if any. */
  dataFreshness: string | null;
}

/** One product's freshness row from its recorded points. */
export function buildFreshnessRow(
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
    gtin: string | null;
    dataFreshness: string | null;
  },
  points: ReadonlyArray<FreshnessPoint | null | undefined>,
  now: Date = new Date()
): FreshnessRow {
  const valid = (points ?? []).filter(
    (p): p is FreshnessPoint => !!p && typeof p.recordedAt === 'string'
  );
  const lastRecordedAt = latestRecordedAt(valid);
  return {
    productId: product.id,
    name: product.name,
    slug: product.slug,
    brand: product.brand,
    category: product.category,
    lastRecordedAt,
    lastRecordedLabel: formatLastChecked(lastRecordedAt),
    ageDays: getPriceAgeDays(lastRecordedAt, now),
    stale: isPriceStale(lastRecordedAt, now),
    pointCount: valid.length,
    missingImage: !product.imageUrl,
    missingGtin: !product.gtin,
    dataFreshness: product.dataFreshness ?? null,
  };
}

/** Catalog-level summary counts for the dashboard header. */
export function summarizeFreshness(rows: FreshnessRow[]): {
  total: number;
  staleCount: number;
  freshCount: number;
  unknownAgeCount: number;
  missingImageCount: number;
  missingGtinCount: number;
  totalPoints: number;
  productsWithHistory: number;
} {
  return {
    total: rows.length,
    staleCount: rows.filter((r) => r.stale).length,
    freshCount: rows.filter((r) => !r.stale && r.ageDays !== null).length,
    unknownAgeCount: rows.filter((r) => r.ageDays === null).length,
    missingImageCount: rows.filter((r) => r.missingImage).length,
    missingGtinCount: rows.filter((r) => r.missingGtin).length,
    totalPoints: rows.reduce((acc, r) => acc + r.pointCount, 0),
    productsWithHistory: rows.filter((r) => r.pointCount > 0).length,
  };
}
