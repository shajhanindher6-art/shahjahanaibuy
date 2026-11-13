/**
 * Section 20, §12 #85 — catalog data-quality summary for /admin/ai.
 *
 * The AI control center showed Provider status, Usage, Accuracy,
 * and Errors — but nothing about the data the AI reasons over.
 * This service computes that panel from stored rows only:
 *   - verification distribution (verified / unverified / stale)
 *   - price freshness (fresh / stale / unknown, STALE_PRICE_DAYS)
 *   - spec / image / GTIN / review coverage across the catalog
 *   - average DATA-quality score (services/product-quality-score.ts
 *     — a data-quality score, never a product-quality score)
 *
 * Fail-safe everywhere, like the rest of the control center:
 * - migration 045 unapplied → the verification columns do not
 *   exist, so every product reads 'unverified' via the normalizer
 *   and `columnsMissing: true` is reported with a note;
 * - a table that errors (or the service client being absent) yields
 *   a partial summary with `notes` explaining what is unknown —
 *   never a zero presented as a measured zero.
 * - an empty catalog yields totals of 0 with a note, not an error.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { getFreshnessStatus } from '@/lib/price-freshness';
import { computeProductQualityScore } from './product-quality-score';
import {
  computeHistoryCoverage,
  computeSourceReliability,
  type HistoryCoverage,
  type PriceHistoryPoint,
  type SourceReliability,
} from './price-history-quality';
import {
  normalizePriceVerificationStatus,
  type PriceVerificationStatus,
} from './price-verification';

export interface AdminDataQualitySummary {
  productsTotal: number;
  productsWithImages: number;
  productsWithGtin: number;
  productsWithSpecs: number;
  productsWithReviews: number;
  productsWithHistory: number;
  priceHistoryPoints: number;
  verification: Record<PriceVerificationStatus, number> & { unknown: number };
  freshness: { fresh: number; stale: number; unknown: number };
  /** Mean data-quality score across products, or null (no products). */
  averageDataQualityScore: number | null;
  /**
   * Per-product price-history coverage (points + span), keyed by
   * product id (Section 20, §12 #44). Empty when the migration-057
   * provenance columns do not exist yet — coverage is not invented
   * from rows that carry no provenance.
   */
  historyCoverage: Record<string, HistoryCoverage>;
  /**
   * Per-source reliability from price_history.source (Section 20,
   * §12 #44); rows with no source group under "unknown". Empty
   * when the migration-057 columns do not exist yet.
   */
  sourceReliability: Record<string, SourceReliability>;
  /** True when the 057 provenance columns do not exist yet. */
  historyProvenanceMissing: boolean;
  /** True when the 045 verification columns do not exist yet. */
  columnsMissing: boolean;
  /** Plain-language notes about what could not be measured. */
  notes: string[];
}

const EMPTY_SUMMARY: AdminDataQualitySummary = {
  productsTotal: 0,
  productsWithImages: 0,
  productsWithGtin: 0,
  productsWithSpecs: 0,
  productsWithReviews: 0,
  productsWithHistory: 0,
  priceHistoryPoints: 0,
  verification: { verified: 0, unverified: 0, stale: 0, unknown: 0 },
  freshness: { fresh: 0, stale: 0, unknown: 0 },
  averageDataQualityScore: null,
  historyCoverage: {},
  sourceReliability: {},
  historyProvenanceMissing: false,
  columnsMissing: false,
  notes: [],
};

function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

export async function getAdminDataQualitySummary(
  supabase: AnySupabaseClient
): Promise<AdminDataQualitySummary> {
  const summary: AdminDataQualitySummary = {
    ...EMPTY_SUMMARY,
    verification: { verified: 0, unverified: 0, stale: 0, unknown: 0 },
    freshness: { fresh: 0, stale: 0, unknown: 0 },
    historyCoverage: {},
    sourceReliability: {},
    historyProvenanceMissing: false,
    notes: [],
  };

  try {
    const runProductsQuery = async (withNewColumns: boolean) => {
      const columns = withNewColumns
        ? 'id, name, slug, brand, category, description, image_url, gtin, price_verification_status, price_verified_at, data_freshness'
        : 'id, name, slug, brand, category, description, image_url, gtin, data_freshness';
      return (await supabase
        .from('products')
        .select(columns)
        .is('deleted_at', null)
        .limit(500)) as unknown as {
        data: Array<Record<string, unknown>> | null;
        error: { code?: string; message: string } | null;
      };
    };
    let { data: products, error } = await runProductsQuery(true);
    if (error && isUndefinedColumnError(error)) {
      summary.columnsMissing = true;
      summary.notes.push(
        'Verification columns do not exist yet (migration 045 not applied), so every product reads as unverified here.'
      );
      ({ data: products, error } = await runProductsQuery(false));
    }
    if (error || !products) {
      if (error) logger.warn('getAdminDataQualitySummary: products query failed', { error: error.message });
      summary.notes.push('Products could not be read, so no data-quality figures are available.');
      return summary;
    }

    const productIds = products.map((p) => String(p.id));
    summary.productsTotal = products.length;
    if (products.length === 0) {
      summary.notes.push('The catalog is empty — there is no data quality to measure yet.');
      return summary;
    }

    // Spec coverage: distinct products with at least one attribute.
    // Counts are kept per product — the quality scorer bands on
    // the count, so a presence-only flag would under-score products
    // with several specs.
    const specCounts = new Map<string, number>();
    try {
      const { data: attrs } = await supabase
        .from('product_attributes')
        .select('product_id')
        .limit(5000);
      for (const row of (attrs ?? []) as Array<{ product_id: string }>) {
        specCounts.set(row.product_id, (specCounts.get(row.product_id) ?? 0) + 1);
      }
    } catch {
      summary.notes.push('Spec coverage could not be read.');
    }
    const specProductIds = new Set(specCounts.keys());

    // Review coverage: distinct products with at least one review.
    const reviewProductIds = new Set<string>();
    try {
      const { data: reviews } = await supabase.from('reviews').select('product_id').limit(5000);
      for (const row of (reviews ?? []) as Array<{ product_id: string }>) {
        reviewProductIds.add(row.product_id);
      }
    } catch {
      summary.notes.push('Review coverage could not be read.');
    }

    // Merchant counts + cheapest listing source, per product.
    const merchantCounts = new Map<string, { total: number; inStock: number; source: string | null }>();
    try {
      const { data: merchants } = await supabase
        .from('merchant_products')
        .select('product_id, price, in_stock, price_source')
        .in('product_id', productIds)
        .is('deleted_at', null)
        .order('price', { ascending: true })
        .limit(5000);
      for (const row of (merchants ?? []) as Array<{
        product_id: string;
        in_stock: boolean;
        price_source?: string | null;
      }>) {
        const entry = merchantCounts.get(row.product_id) ?? { total: 0, inStock: 0, source: null };
        entry.total += 1;
        if (row.in_stock === true) entry.inStock += 1;
        if (entry.source === null) entry.source = row.price_source ?? null;
        merchantCounts.set(row.product_id, entry);
      }
    } catch {
      summary.notes.push('Merchant listings could not be read.');
    }

    // Price history: newest point per product + total points.
    // Section 20, §12 #44 — per-product coverage (points + span)
    // and per-source reliability, from the migration-057
    // provenance columns. The 057 columns may not exist yet
    // (unapplied): select them first, and on 42703 fall back to
    // the legacy columns and report coverage/reliability as
    // unavailable instead of inventing them from rows that carry
    // no provenance.
    const latestHistory = new Map<string, string>();
    const historyCounts = new Map<string, number>();
    const historyPointsByProduct = new Map<string, PriceHistoryPoint[]>();
    const allHistoryPoints: PriceHistoryPoint[] = [];
    try {
      type HistoryRow = {
        product_id: string;
        price?: number | null;
        recorded_at: string;
        source?: string | null;
        suspicious_change?: boolean | null;
      };
      const runHistoryQuery = async (withProvenance: boolean) => {
        const columns = withProvenance
          ? 'product_id, price, recorded_at, source, suspicious_change'
          : 'product_id, recorded_at';
        return (await supabase
          .from('price_history')
          .select(columns)
          .in('product_id', productIds)
          .order('recorded_at', { ascending: false })
          .limit(1000)) as unknown as {
          data: HistoryRow[] | null;
          error: { code?: string; message: string } | null;
        };
      };
      let { data: history, error } = await runHistoryQuery(true);
      if (error && isUndefinedColumnError(error)) {
        summary.historyProvenanceMissing = true;
        summary.notes.push(
          'Price-history provenance columns do not exist yet (migration 057 not applied), so per-product history coverage and per-source reliability cannot be computed.'
        );
        ({ data: history, error } = await runHistoryQuery(false));
      }
      for (const row of (error ? [] : (history ?? [])) as HistoryRow[]) {
        historyCounts.set(row.product_id, (historyCounts.get(row.product_id) ?? 0) + 1);
        if (!latestHistory.has(row.product_id)) latestHistory.set(row.product_id, row.recorded_at);
        if (!summary.historyProvenanceMissing && typeof row.price === 'number') {
          const point: PriceHistoryPoint = {
            price: row.price,
            recordedAt: row.recorded_at,
            source: row.source ?? null,
            suspicious: row.suspicious_change ?? null,
          };
          const perProduct = historyPointsByProduct.get(row.product_id) ?? [];
          perProduct.push(point);
          historyPointsByProduct.set(row.product_id, perProduct);
          allHistoryPoints.push(point);
        }
      }
      summary.priceHistoryPoints = (error ? 0 : (history ?? []).length);
      if (!summary.historyProvenanceMissing) {
        summary.historyCoverage = Object.fromEntries(
          [...historyPointsByProduct.entries()].map(([id, points]) => [
            id,
            computeHistoryCoverage(points),
          ])
        );
        summary.sourceReliability = computeSourceReliability(allHistoryPoints);
      }
    } catch {
      summary.notes.push('Price history could not be read.');
    }
    summary.productsWithHistory = historyCounts.size;

    // Image counts per product (gallery rows).
    const imageCounts = new Map<string, number>();
    try {
      const { data: images } = await supabase
        .from('product_images')
        .select('product_id')
        .in('product_id', productIds)
        .limit(5000);
      for (const row of (images ?? []) as Array<{ product_id: string }>) {
        imageCounts.set(row.product_id, (imageCounts.get(row.product_id) ?? 0) + 1);
      }
    } catch {
      summary.notes.push('Product image rows could not be read.');
    }

    let scoreSum = 0;
    for (const row of products) {
      const id = String(row.id);
      const imageUrl = (row.image_url as string | null) ?? null;
      const gtin = (row.gtin as string | null) ?? null;
      if (imageUrl) summary.productsWithImages += 1;
      if (gtin) summary.productsWithGtin += 1;
      if (specProductIds.has(id)) summary.productsWithSpecs += 1;
      if (reviewProductIds.has(id)) summary.productsWithReviews += 1;

      const status = normalizePriceVerificationStatus(row.price_verification_status);
      if (summary.columnsMissing) summary.verification.unknown += 1;
      else summary.verification[status] += 1;

      const lastCheck =
        latestHistory.get(id) ?? (row.price_verified_at as string | null) ?? (row.data_freshness as string | null) ?? null;
      summary.freshness[getFreshnessStatus(lastCheck).status] += 1;

      const merchants = merchantCounts.get(id);
      const score = computeProductQualityScore(
        {
          name: (row.name as string | null) ?? null,
          slug: (row.slug as string | null) ?? null,
          brand: (row.brand as string | null) ?? null,
          category: (row.category as string | null) ?? null,
          description: (row.description as string | null) ?? null,
          imageUrl,
          gtin,
          priceVerificationStatus: status,
          priceVerifiedAt: (row.price_verified_at as string | null) ?? null,
          dataFreshness: (row.data_freshness as string | null) ?? null,
        },
        {
          specCount: specCounts.get(id) ?? 0,
          imageCount: imageCounts.get(id) ?? 0,
          merchantCount: merchants?.total ?? 0,
          inStockMerchantCount: merchants?.inStock ?? 0,
          priceSource: merchants?.source ?? null,
          lastPriceRecordedAt: latestHistory.get(id) ?? null,
        }
      );
      scoreSum += score.score;
    }
    summary.averageDataQualityScore =
      products.length > 0 ? Math.round((scoreSum / products.length) * 10) / 10 : null;
    return summary;
  } catch (err) {
    logger.error('getAdminDataQualitySummary: unexpected error', { error: String(err) });
    summary.notes.push('Data quality could not be computed.');
    return summary;
  }
}
