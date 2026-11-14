/**
 * ShoppingDecisionService — Master Tool Integration, Stage 4 (S4-1;
 * audit items B-14, B-15 decision recorded in docs/DECISION_SERVICE.md).
 *
 * A THIN orchestrator over the three existing decision services. It
 * composes them in order and adds NO new scoring math, NO new
 * prediction math, and NO invented verdicts:
 *
 *   (a) resolve the product(s) — delegates to
 *       `services/tool-integration.ts#getToolProduct` (Stage-1 cached
 *       fetch), `getToolPriceHistory` and `getToolMerchantProducts`
 *       for the per-product inputs; specs presence via
 *       `services/products.ts#getProductAttributes`; coupons and the
 *       merchant-name map via `services/commerce.ts#getCoupons` /
 *       `getMerchants` (fetched once, shared by every product);
 *   (b) build the decision-matrix rows — delegates to
 *       `services/decision-matrix.ts#buildMatrixRows`;
 *   (c) attach the buy/wait prediction — delegates to
 *       `services/buy-wait-prediction.ts#predictBuyVsWait` (one call
 *       per resolved product; the primary product's prediction is
 *       the top-level `prediction`);
 *   (d) attach the comparison verdict — delegates to
 *       `services/ai-comparison.ts#compareProducts`, ONLY when 2+
 *       products resolved;
 *   (e) return ONE combined, typed result.
 *
 * Honesty rules (standing): a missing input is listed in
 * `dataQuality.missing`, never filled in. The comparison verdict is
 * WITHHELD (never a best-choice id) unless every compared product
 * has at least `BUY_WAIT_MIN_POINTS` recorded price points and a
 * fresh latest price — the same withholding pattern as
 * `lib/deal-score.ts#dealScoreForDisplay`, which withholds the Deal
 * Score below its data-points minimum, and the same bar the
 * buy-wait delegate itself applies (`predictBuyVsWait` returns
 * `not_enough_data` below 5 points and withholds on a stale latest
 * price). Verification status does NOT withhold the ranking — the
 * ranking is over recorded prices, and the delegate's own
 * `sourceLabel` already downgrades an unverified/stale comparison
 * to the recorded-data range label; `dataQuality.verified` reports
 * the stamp separately so callers can label it.
 *
 * `missing[]` is scoped to the inputs THIS decision actually uses:
 * the product row, merchant listings, price history (presence,
 * sufficiency, freshness), specs, GTIN, product image and model
 * number. Ratings and coupons are OPTIONAL matrix cells — the
 * delegate renders them as "—" when absent, so their absence is
 * not a data gap and is not listed.
 *
 * No page or tool is wired to this service in this stage (Stage 4
 * builds the orchestrator only; wiring is a later stage's job).
 * No existing service's behaviour is changed here.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import type { Product } from '@/types';
import type { MerchantProduct } from '@/types/catalog';
import type { ProductComparison } from '@/types/ai';
import {
  getToolProduct,
  getToolPriceHistory,
  getToolMerchantProducts,
} from '@/services/tool-integration';
import { getCoupons, getMerchants } from '@/services/commerce';
import { getProductAttributes } from '@/services/products';
import {
  buildMatrixRows,
  type MatrixProductInput,
  type MatrixRow,
} from '@/services/decision-matrix';
import {
  predictBuyVsWait,
  BUY_WAIT_MIN_POINTS,
  type BuyWaitPrediction,
} from '@/services/buy-wait-prediction';
import { compareProducts } from '@/services/ai-comparison';

/** Input to `buildShoppingDecision`. Slugs are the canonical `?product=` form. */
export interface ShoppingDecisionInput {
  /** Product slugs in priority order; the first resolved product is the primary. */
  productSlugs: string[];
  /** Optional visitor budget in USD — passed straight through to the buy-wait delegate. */
  budgetUsd?: number | null;
}

/** One attributed number/claim: every value in the result names its origin. */
export interface ShoppingDecisionSource {
  /** What the value is, e.g. `lowestPrice:macbook-air-m2`. */
  field: string;
  /** Where it came from, e.g. `merchant_products (recorded listings) via getToolMerchantProducts`. */
  origin: string;
  /** The value itself, when it is a single number/string (omitted for delegated computations). */
  value?: string | number | null;
}

/** The comparison verdict: the delegate's best choice, or withheld with the reason. */
export interface ShoppingDecisionVerdict {
  /** Product id of the delegate's best choice — null whenever the verdict is withheld. */
  bestChoiceProductId: string | null;
  /** True when no best choice is issued (see the module header for the gate). */
  withheld: boolean;
  /** Why the verdict was withheld, or null when a verdict is issued. */
  reason: string | null;
}

/** Honest data-quality rollup for the whole decision. */
export interface ShoppingDecisionDataQuality {
  /**
   * True only when EVERY resolved product carries
   * `priceVerificationStatus === 'verified'`. False on the live
   * catalog (all 10 products unverified) — reported, never faked.
   */
  verified: boolean;
  /** True only when EVERY resolved product's latest recorded price is fresh (≤ 7 days). */
  fresh: boolean;
  /** Every required input that was unavailable, in product order. Empty means nothing was missing. */
  missing: string[];
}

/** The one combined decision result (steps (a)–(e) of the module header). */
export interface ShoppingDecision {
  /** Resolved products, in requested slug order. Unresolvable slugs are omitted (see `missing`). */
  products: Product[];
  /** Matrix rows — delegated to `services/decision-matrix.ts#buildMatrixRows`. */
  matrix: MatrixRow[];
  /**
   * Buy/wait prediction for the primary (first resolved) product —
   * delegated to `services/buy-wait-prediction.ts#predictBuyVsWait`.
   * Null when no product resolved.
   */
  prediction: BuyWaitPrediction | null;
  /** Per-product predictions, keyed by slug (every resolved product, not just the primary). */
  predictionsBySlug: Record<string, BuyWaitPrediction>;
  /**
   * Comparison — delegated to `services/ai-comparison.ts#compareProducts`.
   * ABSENT when fewer than 2 products resolved; null when 2+ resolved
   * but the delegate returned no result.
   */
  comparison?: ProductComparison | null;
  /** The comparison verdict (withheld per the gate in the module header). */
  verdict: ShoppingDecisionVerdict;
  /** Honest data-quality rollup (see `ShoppingDecisionDataQuality`). */
  dataQuality: ShoppingDecisionDataQuality;
  /** Attribution for every number in the result. */
  sources: ShoppingDecisionSource[];
}

interface ResolvedProduct {
  product: Product;
  listings: MerchantProduct[];
  historyPoints: Array<{ price: number; recordedAt: string }>;
  historyFreshness: 'fresh' | 'stale' | 'unknown';
  historyLastRecordedAt: string | null;
  specCount: number;
  lowestListingPrice: number | null;
}

/** Lowest finite positive listing price, or null when there is none. */
function lowestListingPrice(listings: MerchantProduct[]): number | null {
  let min: number | null = null;
  for (const listing of listings) {
    if (!Number.isFinite(listing.price) || listing.price <= 0) continue;
    if (min === null || listing.price < min) min = listing.price;
  }
  return min;
}

/**
 * Build the combined shopping decision for the given product slugs.
 *
 * Delegates to `services/tool-integration.ts#getToolProduct` /
 * `#getToolPriceHistory` / `#getToolMerchantProducts` for resolution
 * (step (a)), `services/decision-matrix.ts#buildMatrixRows` for the
 * matrix (step (b)), `services/buy-wait-prediction.ts#predictBuyVsWait`
 * for the predictions (step (c)), and
 * `services/ai-comparison.ts#compareProducts` for the comparison
 * (step (d), 2+ products only). It performs no scoring or prediction
 * math of its own: the only numbers it computes are the honest
 * rollups — lowest listing price per product (a min over recorded
 * rows), the cheaper-alternative price passed to the buy-wait
 * delegate (the lowest listing price among the OTHER products, so
 * the delegate's own `compare_alternatives` trigger can fire), and
 * the data-quality flags.
 *
 * A slug that resolves to no product is skipped and recorded in
 * `dataQuality.missing` — never invented into a product. A product
 * with no listings, no history, no specs, no GTIN, no image or no
 * model number is still decided on (its matrix cells render "—" via
 * the delegate) with each gap listed in `missing`.
 */
export async function buildShoppingDecision(
  supabase: AnySupabaseClient,
  input: ShoppingDecisionInput
): Promise<ShoppingDecision> {
  const missing: string[] = [];
  const sources: ShoppingDecisionSource[] = [];

  // (a) Resolve the products via the Stage-1 cached fetch.
  // Duplicate slugs resolve once (first occurrence wins the order).
  const slugs = [...new Set((input.productSlugs ?? []).map((s) => s.trim()).filter((s) => s !== ''))];
  if (slugs.length === 0) {
    missing.push('product: no product slug given');
  }

  // Shared matrix inputs, fetched once for all products: the
  // currently-valid coupons and the merchant id → name map (both
  // delegate to services/commerce.ts — getCoupons / getMerchants).
  const coupons = await getCoupons(supabase);
  const merchants = await getMerchants(supabase);
  const merchantNameById: Record<string, string> = {};
  for (const merchant of merchants) {
    merchantNameById[merchant.id] = merchant.name;
  }
  sources.push({
    field: 'coupons',
    origin: 'coupons table (currently-valid only) via services/commerce.ts#getCoupons',
    value: coupons.length,
  });

  const resolved: ResolvedProduct[] = [];
  for (const slug of slugs) {
    const product = await getToolProduct(supabase, slug);
    if (!product) {
      missing.push(`product:${slug} not found`);
      continue;
    }
    sources.push({
      field: `product:${slug}`,
      origin: 'products table via services/tool-integration.ts#getToolProduct',
      value: product.name,
    });

    const history = await getToolPriceHistory(supabase, product.id);
    const listings = await getToolMerchantProducts(supabase, product.id);
    const attributes = await getProductAttributes(supabase, product.id);
    const points = history.history
      .filter((p) => Number.isFinite(p.price) && p.price > 0)
      .map((p) => ({ price: p.price, recordedAt: p.recordedAt }));
    const lowest = lowestListingPrice(listings);

    sources.push({
      field: `lowestPrice:${slug}`,
      origin: 'merchant_products (recorded listings) via services/tool-integration.ts#getToolMerchantProducts',
      value: lowest,
    });
    sources.push({
      field: `priceHistoryPoints:${slug}`,
      origin: 'price_history via services/tool-integration.ts#getToolPriceHistory',
      value: points.length,
    });
    const latest = points.length > 0 ? points[points.length - 1] : null;
    sources.push({
      field: `currentPrice:${slug}`,
      origin: 'price_history (latest recorded point) via services/tool-integration.ts#getToolPriceHistory',
      value: latest ? latest.price : null,
    });

    // Honest gaps for this product, in a fixed order.
    if (listings.length === 0) missing.push(`merchant listings for ${slug}`);
    if (points.length === 0) {
      missing.push(`price history for ${slug}`);
    } else if (points.length < BUY_WAIT_MIN_POINTS) {
      missing.push(
        `sufficient price history for ${slug} (${points.length}/${BUY_WAIT_MIN_POINTS} points)`
      );
    }
    if (points.length > 0 && history.freshness.status !== 'fresh') {
      missing.push(
        `fresh price for ${slug} (latest recorded price is ${history.freshness.status})`
      );
    }
    if (attributes.length === 0) missing.push(`specs for ${slug}`);
    if (!product.gtin) missing.push(`GTIN for ${slug}`);
    if (!product.imageUrl) missing.push(`product image for ${slug}`);
    if (!product.modelNumber) missing.push(`model number for ${slug}`);

    resolved.push({
      product,
      listings,
      historyPoints: points,
      historyFreshness: history.freshness.status,
      historyLastRecordedAt: history.freshness.lastRecordedAt,
      specCount: attributes.length,
      lowestListingPrice: lowest,
    });
  }

  const products = resolved.map((r) => r.product);

  // (b) Build the decision-matrix rows — delegated to
  // services/decision-matrix.ts#buildMatrixRows. Ratings and review
  // counts are null: merchant_products rows carry no rating source
  // (the comparison delegate reads reviews itself); the matrix
  // renders those cells as "—" by the delegate's design.
  const matrixInputs: MatrixProductInput[] = resolved.map((r) => ({
    productId: r.product.id,
    slug: r.product.slug,
    name: r.product.name,
    brand: r.product.brand,
    category: r.product.category,
    retailers: r.listings.map((listing) => ({
      retailerName: merchantNameById[listing.merchantId] ?? 'Retailer',
      price: listing.price,
      rating: null,
      reviewCount: null,
      availability: listing.inStock || listing.availability === 'in_stock' ? 'in_stock' : listing.availability,
    })),
    coupons,
    merchantNameById,
    priceHistory: r.historyPoints,
  }));
  const matrix = buildMatrixRows(matrixInputs);
  sources.push({
    field: 'matrix',
    origin: 'services/decision-matrix.ts#buildMatrixRows (delegated; no new scoring math)',
  });

  // (c) Attach the buy/wait prediction — delegated to
  // services/buy-wait-prediction.ts#predictBuyVsWait, one call per
  // resolved product. The cheaper-alternative price for a product is
  // the lowest listing price among the OTHER resolved products (the
  // delegate's own compare_alternatives input); null when no other
  // product has a recorded price — the delegate never invents one.
  const predictionsBySlug: Record<string, BuyWaitPrediction> = {};
  for (const r of resolved) {
    const othersLowest = resolved
      .filter((other) => other.product.id !== r.product.id)
      .map((other) => other.lowestListingPrice)
      .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
    const cheaperAlternativePrice =
      othersLowest.length > 0 ? Math.min(...othersLowest) : null;
    predictionsBySlug[r.product.slug] = predictBuyVsWait(r.historyPoints, {
      budgetUsd: input.budgetUsd ?? null,
      cheaperAlternativePrice,
    });
  }
  sources.push({
    field: 'prediction',
    origin: 'services/buy-wait-prediction.ts#predictBuyVsWait (delegated; no new prediction math)',
  });
  const primary = resolved[0];
  const prediction = primary ? predictionsBySlug[primary.product.slug] : null;

  // (d) Attach the comparison verdict — delegated to
  // services/ai-comparison.ts#compareProducts, ONLY when 2+
  // products resolved. With fewer, the field stays absent.
  let comparison: ProductComparison | null | undefined;
  if (resolved.length >= 2) {
    comparison = await compareProducts(
      supabase,
      resolved.map((r) => r.product.id)
    );
    sources.push({
      field: 'comparison',
      origin: 'services/ai-comparison.ts#compareProducts (delegated; no new verdict math)',
    });
  }

  // (e) The verdict gate — withheld unless every compared product
  // clears the same bar the delegates apply themselves: at least
  // BUY_WAIT_MIN_POINTS recorded points AND a fresh latest price.
  // (The dealScoreForDisplay pattern: withheld below the data-points
  // minimum, never a synthesized verdict on thin/stale data.)
  let verdict: ShoppingDecisionVerdict;
  if (resolved.length < 2) {
    verdict = {
      bestChoiceProductId: null,
      withheld: true,
      reason: 'No comparison verdict — fewer than two products were resolved.',
    };
  } else if (comparison === null || comparison === undefined) {
    verdict = {
      bestChoiceProductId: null,
      withheld: true,
      reason: 'No comparison verdict — the comparison service returned no result.',
    };
  } else {
    const thin = resolved.find(
      (r) => (predictionsBySlug[r.product.slug]?.pointCount ?? 0) < BUY_WAIT_MIN_POINTS
    );
    const stale = resolved.find((r) => r.historyFreshness !== 'fresh');
    if (thin) {
      const count = predictionsBySlug[thin.product.slug]?.pointCount ?? 0;
      verdict = {
        bestChoiceProductId: null,
        withheld: true,
        reason:
          `No comparison verdict — ${thin.product.slug} has only ${count} recorded price ` +
          `point${count === 1 ? '' : 's'} (at least ${BUY_WAIT_MIN_POINTS} are needed).`,
      };
    } else if (stale) {
      verdict = {
        bestChoiceProductId: null,
        withheld: true,
        reason:
          `No comparison verdict — the latest recorded price for ${stale.product.slug} is ` +
          `${stale.historyFreshness}` +
          (stale.historyLastRecordedAt ? ` (last recorded ${stale.historyLastRecordedAt})` : '') +
          '.',
      };
    } else {
      verdict = {
        bestChoiceProductId: comparison.bestChoice,
        withheld: false,
        reason: null,
      };
    }
  }

  const dataQuality: ShoppingDecisionDataQuality = {
    verified:
      resolved.length > 0 &&
      resolved.every((r) => r.product.priceVerificationStatus === 'verified'),
    fresh:
      resolved.length > 0 &&
      resolved.every((r) => r.historyFreshness === 'fresh'),
    missing,
  };

  const decision: ShoppingDecision = {
    products,
    matrix,
    prediction,
    predictionsBySlug,
    verdict,
    dataQuality,
    sources,
  };
  if (resolved.length >= 2) {
    decision.comparison = comparison ?? null;
  }
  return decision;
}
