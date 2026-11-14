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
import { assertAdminServiceAccess } from '@/lib/admin-role';
import { getFreshnessStatus } from '@/lib/price-freshness';
import {
  computeProductQualityScore,
  getDataQualityState,
  isValidGtin,
  type DataQualityState,
} from './product-quality-score';
import {
  computeHistoryCoverage,
  computeSourceReliability,
  type HistoryCoverage,
  type PriceHistoryPoint,
  type SourceReliability,
} from './price-history-quality';
import {
  derivePriceState,
  type PriceState,
} from '@/lib/verification/price-state';
import {
  normalizePriceVerificationStatus,
  type PriceVerificationStatus,
} from './price-verification';
import {
  LIVE_PRICE_HISTORY_SOURCES,
  resolveLastSuccessfulUpdate,
  type LastSuccessfulUpdate,
} from './last-successful-update';
import {
  getDashboardMerchantReliability,
  type DashboardMerchantReliabilityRow,
} from './canonical-merchant-reliability';

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
  /**
   * FINAL 100% (F-P1-50) — the canonical merchant-reliability
   * data layer for the dashboard page: one row per merchant with
   * the canonical (policy) score FIRST, plus the two supporting
   * dimensions (sync + per-source price-history reliability),
   * each labelled. The dashboard page renders `canonical` as
   * "Merchant reliability" and the other two under their own
   * labels — they are never conflated. Empty when the merchants
   * table could not be read. The dashboard page itself is
   * another worker's; this field is the clean exposure they
   * render from.
   */
  merchantReliability: DashboardMerchantReliabilityRow[];
  /** True when the 057 provenance columns do not exist yet. */
  historyProvenanceMissing: boolean;
  /** True when the 045 verification columns do not exist yet. */
  columnsMissing: boolean;
  /**
   * Section 21–25, Stage H (H-P2-4) — true when the 045
   * `merchant_products.price_source` column does not exist yet.
   * The merchant read then retries without it (counts stay right),
   * but the attribution dimension cannot count a recorded price
   * source, so the average score may understate data quality.
   */
  merchantSourceMissing: boolean;
  /**
   * True when any missing-column flag above means the average
   * score may understate data quality (columnsMissing or
   * merchantSourceMissing). The admin panel must say so next to
   * the score instead of showing a bare number.
   */
  scoreMayUnderstate: boolean;
  /**
   * Section 21–25, Stage H (H-P2-2) — the 5-state data-quality
   * taxonomy distribution across the catalog (Verified /
   * Partially verified / Unverified / Stale / Missing
   * information), the same label system the public product page
   * shows per product.
   */
  qualityStates: Record<DataQualityState, number>;
  /**
   * FINAL 100% (W1, F-P1-29) — the brief's 5-state price machine
   * distribution across the catalog (Live verified /
   * Historically verified / Unverified / Stale / Source
   * unavailable), derived from the same inputs as qualityStates
   * so the two distributions can never drift apart. Only
   * LIVE_VERIFIED may be shown with live/current wording.
   */
  priceStates: Record<PriceState, number>;
  /**
   * Sections 21–25, Stage D (item 3) — per-product "last
   * successful update": the last time a real provider response
   * was validated AND saved, distinct from `data_freshness`
   * ("last checked"). `at` is null when no successful update is
   * recorded anywhere for the product; `source` says which
   * durable record produced the value ('column' = the stored
   * migration-066 value, 'price-history' / 'merchant-sync' =
   * derived — see services/last-successful-update.ts).
   */
  lastSuccessfulUpdate: Record<string, LastSuccessfulUpdate>;
  /** Products with a recorded successful update (at !== null). */
  productsWithSuccessfulUpdate: number;
  /** True when the 066 `last_successful_update` column does not exist yet (values are derived only). */
  lastSuccessfulUpdateColumnMissing: boolean;
  /**
   * Final 100% — F-P2-15: suspicious price changes awaiting
   * review. Detection existed (assessPriceChange at ingestion /
   * refresh) but no surface ever listed flagged rows and nothing
   * alerted on a flag — detection without review. Each entry is
   * one `price_history` row whose `suspicious_change` flag is set
   * (migration 057); empty when 057 is unapplied (the flag is
   * then dropped by the 42703 retry and cannot be listed — see
   * historyProvenanceMissing + notes). The admin panel renders
   * this list with a "needs review" banner, and the count is the
   * notification: any admin opening the data-quality panel sees
   * it. Email notification needs Resend (owner-gated, not
   * configured) — recorded as the open half of this item.
   */
  suspiciousPriceFlags: Array<{
    productId: string;
    productName: string | null;
    price: number | null;
    recordedAt: string;
    source: string | null;
  }>;
  /** Count of suspiciousPriceFlags — the review-queue size. */
  suspiciousPriceFlagCount: number;
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
  merchantReliability: [],
  historyProvenanceMissing: false,
  columnsMissing: false,
  merchantSourceMissing: false,
  scoreMayUnderstate: false,
  qualityStates: { verified: 0, partial: 0, unverified: 0, stale: 0, missing: 0 },
  priceStates: { LIVE_VERIFIED: 0, HISTORICAL_VERIFIED: 0, UNVERIFIED: 0, STALE: 0, SOURCE_UNAVAILABLE: 0 },
  lastSuccessfulUpdate: {},
  productsWithSuccessfulUpdate: 0,
  lastSuccessfulUpdateColumnMissing: false,
  suspiciousPriceFlags: [],
  suspiciousPriceFlagCount: 0,
  notes: [],
};

function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

export async function getAdminDataQualitySummary(
  supabase: AnySupabaseClient,
  opts: { adminUserId?: string } = {}
): Promise<AdminDataQualitySummary> {
  // Sections 21–25, Stage G, G-P1-4 — defense-in-depth role
  // re-check (see lib/admin-role.ts). Optional ONLY so existing
  // unit tests without an auth context keep compiling; every
  // production caller passes adminUserId.
  if (opts.adminUserId !== undefined) {
    await assertAdminServiceAccess(supabase, opts.adminUserId);
  }
  const summary: AdminDataQualitySummary = {
    ...EMPTY_SUMMARY,
    verification: { verified: 0, unverified: 0, stale: 0, unknown: 0 },
    freshness: { fresh: 0, stale: 0, unknown: 0 },
    historyCoverage: {},
    sourceReliability: {},
    merchantReliability: [],
    historyProvenanceMissing: false,
    merchantSourceMissing: false,
    scoreMayUnderstate: false,
    qualityStates: { verified: 0, partial: 0, unverified: 0, stale: 0, missing: 0 },
    priceStates: { LIVE_VERIFIED: 0, HISTORICAL_VERIFIED: 0, UNVERIFIED: 0, STALE: 0, SOURCE_UNAVAILABLE: 0 },
    suspiciousPriceFlags: [],
    suspiciousPriceFlagCount: 0,
    notes: [],
  };

  try {
    // Sections 21–25, Stage D (item 3) — the stored
    // `last_successful_update` value per product (migration 066),
    // when the column exists. Filled from the products query
    // below when the 066 column is present, or from the
    // 066-only retry when the 045 fallback ran.
    const columnValueById = new Map<string, string | null>();
    const runProductsQuery = async (withNewColumns: boolean) => {
      const columns = withNewColumns
        ? 'id, name, slug, brand, category, description, image_url, gtin, price_verification_status, price_verified_at, data_freshness, last_successful_update'
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
      // The 045 fallback also drops the 066 column from the
      // select — retry with ONLY the 066 column to learn whether
      // it exists independently of 045.
      try {
        const { data: columnRows, error: columnError } = (await supabase
          .from('products')
          .select('id, last_successful_update')
          .is('deleted_at', null)
          .limit(500)) as unknown as {
          data: Array<{ id: string; last_successful_update: string | null }> | null;
          error: { code?: string; message: string } | null;
        };
        if (columnError && isUndefinedColumnError(columnError)) {
          summary.lastSuccessfulUpdateColumnMissing = true;
          summary.notes.push(
            'Last-successful-update column does not exist yet (migration 066 not applied), so last-successful-update values below are derived from price history and merchant syncs, not stored.'
          );
        } else if (!columnError) {
          for (const row of columnRows ?? []) {
            columnValueById.set(String(row.id), row.last_successful_update ?? null);
          }
        }
      } catch {
        summary.notes.push('Last-successful-update column could not be read.');
      }
    } else if (!error) {
      for (const row of products ?? []) {
        columnValueById.set(
          String(row.id),
          (row.last_successful_update as string | null) ?? null
        );
      }
    }
    if (error || !products) {
      if (error) logger.warn('getAdminDataQualitySummary: products query failed', { error: error.message });
      summary.notes.push('Products could not be read, so no data-quality figures are available.');
      return summary;
    }

    const productIds = products.map((p) => String(p.id));
    const productNameById = new Map<string, string>(
      products.map((p) => [String(p.id), String(p.name ?? '')])
    );
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
    // Section 21–25, Stage H (H-P2-4) — this query used to select
    // `price_source` (migration 045) with no 42703 fallback: when
    // 045 was unapplied the whole query errored, the catch below
    // swallowed it, and every product silently scored 0 on the
    // merchant dimension (25/100 instead of 35/100) with only a
    // buried note. Now it retries without the column — counts stay
    // right — and reports merchantSourceMissing so the panel can
    // say the score may understate instead of showing a bare 25.
    const merchantCounts = new Map<string, { total: number; inStock: number; source: string | null }>();
    // Sections 21–25, Stage D (item 3) — latest merchant sync
    // time per product (`merchant_products.last_synced_at`, 045 —
    // set only by the eBay live-check stamp), one leg of the
    // derived last-successful-update.
    const merchantSyncedAt = new Map<string, string>();
    try {
      type MerchantRow = {
        product_id: string;
        in_stock: boolean;
        price_source?: string | null;
        last_synced_at?: string | null;
      };
      const runMerchantQuery = async (withSource: boolean) => {
        const columns = withSource
          ? 'product_id, price, in_stock, price_source, last_synced_at'
          : 'product_id, price, in_stock';
        return (await supabase
          .from('merchant_products')
          .select(columns)
          .in('product_id', productIds)
          .is('deleted_at', null)
          .order('price', { ascending: true })
          .limit(5000)) as unknown as {
          data: MerchantRow[] | null;
          error: { code?: string; message: string } | null;
        };
      };
      let { data: merchants, error: merchantError } = await runMerchantQuery(true);
      if (merchantError && isUndefinedColumnError(merchantError)) {
        summary.merchantSourceMissing = true;
        summary.notes.push(
          'Merchant price-source column does not exist yet (migration 045 not applied), so the attribution dimension cannot count a recorded price source — the average score may understate data quality.'
        );
        ({ data: merchants, error: merchantError } = await runMerchantQuery(false));
      }
      if (merchantError) {
        logger.warn('getAdminDataQualitySummary: merchant listings query failed', {
          error: merchantError.message,
        });
        summary.notes.push('Merchant listings could not be read.');
      }
      for (const row of (merchantError ? [] : (merchants ?? [])) as MerchantRow[]) {
        const entry = merchantCounts.get(row.product_id) ?? { total: 0, inStock: 0, source: null };
        entry.total += 1;
        if (row.in_stock === true) entry.inStock += 1;
        if (entry.source === null) entry.source = row.price_source ?? null;
        merchantCounts.set(row.product_id, entry);
        if (row.last_synced_at) {
          const prev = merchantSyncedAt.get(row.product_id);
          if (!prev || row.last_synced_at > prev) merchantSyncedAt.set(row.product_id, row.last_synced_at);
        }
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
          // Final 100% — F-P2-15: the review queue. A flagged
          // row is listed here (with product, price, date and
          // source) so an admin can review it — detection without
          // a review surface was dead. Only rows whose flag
          // SURVIVED storage are listed; when 057 is unapplied
          // the flag is dropped on write and nothing can be
          // listed (historyProvenanceMissing says so in notes).
          if (row.suspicious_change === true) {
            summary.suspiciousPriceFlags.push({
              productId: row.product_id,
              productName: productNameById.get(row.product_id) ?? null,
              price: row.price,
              recordedAt: row.recorded_at,
              source: row.source ?? null,
            });
          }
        }
      }
      summary.priceHistoryPoints = (error ? 0 : (history ?? []).length);
      summary.suspiciousPriceFlagCount = summary.suspiciousPriceFlags.length;
      if (summary.suspiciousPriceFlagCount > 0) {
        summary.notes.push(
          `${summary.suspiciousPriceFlagCount} suspicious price change${summary.suspiciousPriceFlagCount === 1 ? '' : 's'} need${summary.suspiciousPriceFlagCount === 1 ? 's' : ''} review — see suspiciousPriceFlags. A flag is a pattern description (spike / fake-sale / inflation), never an accusation; check the merchant listing before acting.`
        );
      }
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
      // Section 21–25, Stage H (H-P2-2) — the same 5-state taxonomy
      // the public product page shows, counted here per product so
      // the admin distribution and the public label can never drift
      // apart: both call getDataQualityState with the same inputs.
      const state = getDataQualityState({
        priceVerificationStatus: status,
        priceAgeDays: score.priceAgeDays,
        merchantCount: merchants?.total ?? 0,
        hasValidGtin: isValidGtin(gtin),
        hasPriceSource: (merchants?.source ?? null) !== null,
      });
      summary.qualityStates[state.state] += 1;

      // FINAL 100% (W1, F-P1-29) — the brief's 5 states, counted
      // from the same inputs as the taxonomy above, so the admin
      // distribution and the per-product price state are the same
      // function, not two opinions.
      const priceState = derivePriceState({
        priceVerificationStatus: status,
        priceVerifiedAt: (row.price_verified_at as string | null) ?? null,
        priceAgeDays: score.priceAgeDays,
        hasRecordedPrice: (merchants?.total ?? 0) > 0 || latestHistory.has(id),
        hasLiveSource: null,
      });
      summary.priceStates[priceState.state] += 1;

      // Sections 21–25, Stage D (item 3) — last successful
      // update, distinct from "last checked" (`lastCheck` above):
      // the stored 066 value when the column exists, otherwise
      // the latest live-source price-history point (a re-read row
      // carries source NULL and never counts) or the latest
      // merchant sync. Null for the whole seeded catalog is the
      // honest state — no provider-validated save has happened.
      const liveHistoryPoints = (historyPointsByProduct.get(id) ?? []).filter((p) =>
        (LIVE_PRICE_HISTORY_SOURCES as readonly string[]).includes(p.source ?? '')
      );
      const liveHistoryAt =
        liveHistoryPoints.length > 0
          ? liveHistoryPoints
              .map((p) => p.recordedAt)
              .sort()
              .at(-1) ?? null
          : null;
      const lastSuccessful = resolveLastSuccessfulUpdate(
        columnValueById.get(id) ?? null,
        liveHistoryAt,
        merchantSyncedAt.get(id) ?? null,
        summary.lastSuccessfulUpdateColumnMissing
      );
      summary.lastSuccessfulUpdate[id] = lastSuccessful;
      if (lastSuccessful.at !== null) summary.productsWithSuccessfulUpdate += 1;
    }
    summary.averageDataQualityScore =
      products.length > 0 ? Math.round((scoreSum / products.length) * 10) / 10 : null;
    // FINAL 100% (F-P1-50) — canonical merchant reliability for
    // the dashboard page: one row per merchant, canonical score
    // first, supporting dimensions labelled. S2-7: the canonical
    // score is the POLICY scorer; the SYNC scorer rides along in
    // the row as a labelled supporting dimension only (deal ranking
    // is its only scoring use). Best-effort: a
    // failed read leaves the empty array (the page renders an
    // honest "not available" state, never a guessed score).
    try {
      summary.merchantReliability = await getDashboardMerchantReliability(
        supabase,
        allHistoryPoints
      );
    } catch {
      summary.merchantReliability = [];
      summary.notes.push('Merchant reliability could not be computed.');
    }
    // Section 21–25, Stage H (H-P2-4) — the average is a lower
    // bound while a verification/source column is missing: say so
    // on the surface instead of showing a bare number.
    summary.scoreMayUnderstate = summary.columnsMissing || summary.merchantSourceMissing;
    return summary;
  } catch (err) {
    logger.error('getAdminDataQualitySummary: unexpected error', { error: String(err) });
    summary.notes.push('Data quality could not be computed.');
    return summary;
  }
}
