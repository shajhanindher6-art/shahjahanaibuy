/**
 * AI deal ranking service.
 * Ranks deals by AI score and categorizes them (flash, coupon, hidden, student, holiday).
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { swrGet, cacheKey } from '@/lib/cache';
import type { DealRanking } from '@/types/ai';
import type { Deal } from '@/types/catalog';
import type { Product } from '@/types';
import { getLatestPrices } from './price-history';
import {
  validateDealDiscount,
  fetchDealHistoryByProduct,
  dedupeByKey,
  dealIdentityKey,
  type DealDiscountValidation,
} from './deal-validation';

export interface RankedDealsResult {
  deals: Array<
    DealRanking & {
      deal: Deal | null;
      product: Product | null;
      currentPrice: number | null;
      /**
       * Section 19, Phase 2 (§12 #23) — the history validation
       * behind this row's featured flag. `validated` means the
       * claimed discount survived the fake-sale / inflation
       * checks on recorded history; `flagged` / `insufficient`
       * rows are never featured (see scoreDeal).
       */
      discountValidation?: DealDiscountValidation;
    }
  >;
  total: number;
  categories: string[];
}

/**
 * Section 19, Phase 0 (§12 #24) — derive a deal's discount
 * percentage from a REAL price, never from a formula.
 * - percentage deals: the merchant-stated discountValue IS the %.
 * - fixed deals: discountValue / current recorded price × 100
 *   (a $20-off deal on a $999 product is 2.0% off; on a $99
 *   product it is 20.2% off — the old `(value/100)*10` formula
 *   said 2% for both, a made-up number).
 * - no recorded price (or a non-positive one) -> null: the API
 *   reports "no percentage available", never an invented number.
 * Callers treat null as a 0 contribution to aiScore, never as a
 * fabricated percentage.
 */
function deriveDiscountPercentage(
  deal: Deal,
  currentPrice: number | null
): number | null {
  if (deal.discountType === 'percentage') return deal.discountValue;
  if (deal.discountType === 'fixed') {
    if (currentPrice === null || currentPrice <= 0) return null;
    return Math.round((deal.discountValue / currentPrice) * 1000) / 10;
  }
  return null;
}

/**
 * Section 19, Phase 0 (§12 #24) — the aiScore / featured
 * computation, shared by the fresh-ranking path and the cached
 * read path so both consume the SAME honest percentage. A null
 * percentage contributes 0 — it never becomes a fabricated
 * number, and a deal can still reach "featured" on its flash /
 * value / confidence terms alone.
 *
 * WEIGHTS (documented — §12 #59 value ranking, Phase 2):
 *   base 50
 *   + claimed discount% × 0.5 (the merchant's stated %, or the
 *     Phase 0 derivation for fixed deals; null → 0)
 *   + 20 flash (ends < 24h)
 *   + 15 discountValue ≥ $30
 *   + 10 product confidenceScore ≥ 70
 *   + VALUE TERM (Phase 2, §12 #59): +10 when the current
 *     recorded price is at or within 5% above the lowest recorded
 *     price, +5 when within 15% above it, 0 otherwise — and 0
 *     when no recorded low exists. This is the actual-value term:
 *     a 40%-off claim on a just-inflated compare-at price scores
 *     the claim, but a price genuinely at its recorded low scores
 *     the reality. No history → 0, never a guessed value.
 *
 * FEATURED GATE (§12 #23/#60, Phase 2): isFeatured requires
 * aiScore ≥ 75 AND a `validated` discount validation — no
 * featured flag without price evidence. A high score on thin or
 * pattern-flagged history is ranked, never featured.
 */
function scoreDeal(
  deal: Deal,
  product: Product | null,
  discountPercentage: number | null,
  now: Date,
  value?: { currentPrice: number | null; lowestPrice: number | null },
  validation?: DealDiscountValidation
): { aiScore: number; isFeatured: boolean } {
  const hoursUntilEnd = (new Date(deal.endAt).getTime() - now.getTime()) / (60 * 60 * 1000);
  const isFlash = hoursUntilEnd < 24;

  let aiScore = 50;
  aiScore += (discountPercentage ?? 0) * 0.5;
  if (isFlash) aiScore += 20;
  if (deal.discountValue >= 30) aiScore += 15;
  if (product && product.confidenceScore >= 70) aiScore += 10;
  // Value term (§12 #59): actual value from recorded prices.
  const currentPrice = value?.currentPrice ?? null;
  const lowestPrice = value?.lowestPrice ?? null;
  if (currentPrice !== null && lowestPrice !== null && lowestPrice > 0) {
    if (currentPrice <= lowestPrice * 1.05) aiScore += 10;
    else if (currentPrice <= lowestPrice * 1.15) aiScore += 5;
  }
  aiScore = Math.min(100, aiScore);

  // Featured needs price evidence, not just a high score: the
  // validation must have passed. Callers that have no validation
  // (no history fetched) pass undefined → not featured.
  const isFeatured = aiScore >= 75 && validation?.status === 'validated';
  return { aiScore, isFeatured };
}

/**
 * Attach each deal product's latest recorded price (one query for
 * all products). Deal cards show this as the "current price" — a
 * null price renders as "price not listed", never a guess.
 */
async function attachCurrentPrices<T extends { productId: string | null }>(
  supabase: AnySupabaseClient,
  deals: T[]
): Promise<Array<T & { currentPrice: number | null }>> {
  const prices = await getLatestPrices(
    supabase,
    deals.map((d) => d.productId).filter(Boolean) as string[]
  );
  return deals.map((d) => ({
    ...d,
    currentPrice: d.productId ? (prices.get(d.productId) ?? null) : null,
  }));
}

export async function getRankedDeals(
  supabase: AnySupabaseClient,
  options: { dealType?: string; limit?: number; featuredOnly?: boolean } = {}
): Promise<RankedDealsResult> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));

  try {
    // Section 18, item 30 — explicit columns (was select('*')):
    // exactly the fields the ranking map below reads.
    let query = supabase
      .from('deal_rankings')
      .select('id, deal_id, product_id, deal_type, ai_score, discount_percentage, savings_amount, is_featured, ranked_at')
      .order('ai_score', { ascending: false })
      .order('ranked_at', { ascending: false })
      .limit(limit);

    if (options.dealType) {
      query = query.eq('deal_type', options.dealType);
    }
    if (options.featuredOnly) {
      query = query.eq('is_featured', true);
    }

    const { data: rankingsData, error } = await query;

    if (error || !rankingsData || rankingsData.length === 0) {
      if (error) logger.warn('getRankedDeals: query failed', { error: error.message });
      return await generateFreshRankings(supabase, options);
    }

    const rankings = rankingsData as Array<Record<string, unknown>>;
    const dealIds = rankings.map((r) => r.deal_id as string | null).filter(Boolean) as string[];
    const productIds = rankings.map((r) => r.product_id as string | null).filter(Boolean) as string[];

    const [dealsMap, productsMap] = await Promise.all([
      fetchDeals(supabase, dealIds),
      fetchProducts(supabase, productIds),
    ]);

    const deals = rankings.map((r) => {
      const dealId = r.deal_id as string | null;
      const productId = r.product_id as string | null;
      return {
        id: r.id as string,
        dealId,
        productId,
        dealType: r.deal_type as string,
        aiScore: parseFloat(String(r.ai_score)),
        discountPercentage: parseFloat(String(r.discount_percentage)),
        savingsAmount: parseFloat(String(r.savings_amount)),
        isFeatured: r.is_featured as boolean,
        rankedAt: r.ranked_at as string,
        deal: dealId ? (dealsMap.get(dealId) ?? null) : null,
        product: productId ? (productsMap.get(productId) ?? null) : null,
      };
    });

    const categories = Array.from(new Set(deals.map((d) => d.dealType)));
    const dealsWithPrices = await attachCurrentPrices(supabase, deals);

    // Section 19, Phase 2 (§12 #23/#59/#60): history validation
    // for every ranked product (one getPriceHistory call per
    // product). The stored discount_percentage / ai_score /
    // is_featured are NEVER trusted — they were written from
    // claimed discounts alone — so each row is re-validated and
    // re-scored here, and the featured flag is re-gated on the
    // validation passing.
    const historyByProduct = await fetchDealHistoryByProduct(
      supabase,
      dealsWithPrices.map((d) => d.productId).filter(Boolean) as string[]
    );
    const validateRow = (d: (typeof dealsWithPrices)[number]) => {
      if (!d.deal || !d.productId) return undefined;
      const history = historyByProduct.get(d.productId);
      if (!history) return undefined;
      return validateDealDiscount({
        history: history.points,
        currentPrice: d.currentPrice,
        discountType: d.deal.discountType,
        discountValue: d.deal.discountValue,
      });
    };

    const now = new Date();
    const honest = dealsWithPrices.map((d) => {
      const discountPercentage =
        d.deal?.discountType === 'fixed'
          ? deriveDiscountPercentage(d.deal, d.currentPrice)
          : d.deal?.discountType === 'percentage'
            ? d.deal.discountValue
            : d.discountPercentage;
      if (!d.deal) return { ...d, discountPercentage };
      const discountValidation = validateRow(d);
      const history = d.productId ? historyByProduct.get(d.productId) : undefined;
      const { aiScore, isFeatured } = scoreDeal(
        d.deal,
        d.product,
        discountPercentage,
        now,
        { currentPrice: d.currentPrice, lowestPrice: history?.lowest ?? null },
        discountValidation
      );
      return { ...d, discountPercentage, aiScore, isFeatured, discountValidation };
    });
    // Section 19, Phase 2 (§12 #66): two identical active deals
    // (same product + merchant + discount + window) rank as ONE
    // row — the cached deal_rankings rows can hold duplicates
    // written before migration 054. Rows with no deal row keep
    // their own id as the key, so they never collapse together.
    const deduped = dedupeByKey(honest, (d) =>
      d.deal
        ? dealIdentityKey({
            productId: d.deal.productId,
            merchantId: d.deal.merchantId,
            discountType: d.deal.discountType,
            discountValue: d.deal.discountValue,
            startAt: d.deal.startAt,
            endAt: d.deal.endAt,
          })
        : `missing-deal:${d.dealId ?? d.id}`
    );
    // Display order follows the displayed scores (the query
    // ordered by the stored ai_score, which the recompute above
    // may have changed for legacy rows).
    deduped.sort(
      (a, b) =>
        b.aiScore - a.aiScore ||
        new Date(b.rankedAt).getTime() - new Date(a.rankedAt).getTime()
    );

    return { deals: deduped, total: deduped.length, categories };
  } catch (err) {
    logger.error('getRankedDeals: unexpected error', { error: String(err) });
    return { deals: [], total: 0, categories: [] };
  }
}

async function generateFreshRankings(
  supabase: AnySupabaseClient,
  options: { dealType?: string; limit?: number; featuredOnly?: boolean }
): Promise<RankedDealsResult> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));

  const { data: dealsData, error } = await supabase
    .from('deals')
    .select('id, product_id, merchant_id, title, description, deal_type, discount_type, discount_value, start_at, end_at, coupon_code, url, active')
    .eq('active', true)
    .is('deleted_at', null)
    .gte('end_at', new Date().toISOString())
    .order('discount_value', { ascending: false })
    .limit(limit * 2);

  if (error || !dealsData || dealsData.length === 0) {
    return { deals: [], total: 0, categories: [] };
  }

  const deals = dealsData as Array<Record<string, unknown>>;
  // Section 19, Phase 2 (§12 #66): collapse identical active
  // deals (same product + merchant + discount + window) BEFORE
  // ranking, so two identical rows never become two ranked rows
  // — and never write two deal_rankings rows either.
  const dedupedDeals = dedupeByKey(deals, (dRow) =>
    dealIdentityKey({
      productId: dRow.product_id as string | null,
      merchantId: dRow.merchant_id as string | null,
      discountType: dRow.discount_type as string,
      discountValue: parseFloat(String(dRow.discount_value)),
      startAt: dRow.start_at as string,
      endAt: dRow.end_at as string,
    })
  );
  const productIds = dedupedDeals.map((d) => d.product_id as string).filter(Boolean);
  const productsMap = await fetchProducts(supabase, productIds as string[]);
  // Section 19, Phase 0 (§12 #24): the current recorded price
  // per product, fetched ONCE — fixed-amount deals derive their
  // percentage from it (see deriveDiscountPercentage), never
  // from the old `(value/100)*10` formula.
  const pricesByProduct = await getLatestPrices(supabase, productIds as string[]);
  // Section 19, Phase 2 (§12 #23): recorded history per product,
  // fetched ONCE — the fake-sale / inflation validation and the
  // value term both read from it (see validateDealDiscount).
  const historyByProduct = await fetchDealHistoryByProduct(supabase, productIds as string[]);

  const ranked: Array<DealRanking & { deal: Deal | null; product: Product | null; currentPrice: number | null; discountValidation?: DealDiscountValidation }> = [];
  const now = new Date();

  for (const dRow of dedupedDeals) {
    const deal = mapDealRow(dRow);
    const productId = dRow.product_id as string | null;
    const product = productId ? (productsMap.get(productId) ?? null) : null;
    const currentPrice = productId ? (pricesByProduct.get(productId) ?? null) : null;

    const discountPercentage = deriveDiscountPercentage(deal, currentPrice);

    const savingsAmount = deal.discountType === 'fixed' ? deal.discountValue : 0;

    const hoursUntilEnd = (new Date(deal.endAt).getTime() - now.getTime()) / (60 * 60 * 1000);
    const isFlash = hoursUntilEnd < 24;
    const isCoupon = !!deal.couponCode;

    let dealType = 'general';
    if (isFlash) dealType = 'flash';
    else if (isCoupon) dealType = 'coupon';
    else if (deal.title?.toLowerCase().includes('student')) dealType = 'student';
    else if (deal.title?.toLowerCase().includes('holiday') || deal.title?.toLowerCase().includes('christmas') || deal.title?.toLowerCase().includes('black friday')) dealType = 'holiday';
    else if (deal.discountValue >= 30) dealType = 'hidden';

    // Section 19, Phase 2 (§12 #23/#59/#60): the claimed
    // discount is validated against recorded history, the score
    // gains the actual-value term, and the featured flag is
    // gated on the validation passing — a high score alone never
    // features a deal.
    const history = productId ? historyByProduct.get(productId) : undefined;
    const discountValidation = history
      ? validateDealDiscount({
          history: history.points,
          currentPrice,
          discountType: deal.discountType,
          discountValue: deal.discountValue,
        })
      : undefined;
    const { aiScore, isFeatured } = scoreDeal(
      deal,
      product,
      discountPercentage,
      now,
      { currentPrice, lowestPrice: history?.lowest ?? null },
      discountValidation
    );

    ranked.push({
      id: '',
      dealId: deal.id,
      productId,
      dealType,
      aiScore,
      discountPercentage,
      savingsAmount,
      isFeatured,
      rankedAt: now.toISOString(),
      deal,
      product,
      // Filled by attachCurrentPrices below (one query for all).
      currentPrice: null,
      discountValidation,
    });

    void supabase.from('deal_rankings').insert({
      deal_id: deal.id,
      product_id: productId,
      deal_type: dealType,
      ai_score: aiScore,
      // The column is NOT NULL: a null (underivable) percentage is
      // stored as 0, which the read path NEVER surfaces for fixed
      // deals — it recomputes from the deal + current price (§12
      // #24), so the stored 0 is a placeholder, not a claim.
      discount_percentage: discountPercentage ?? 0,
      savings_amount: savingsAmount,
      is_featured: isFeatured,
    });
  }

  ranked.sort((a, b) => b.aiScore - a.aiScore);

  const filtered = options.dealType ? ranked.filter((d) => d.dealType === options.dealType) : ranked;
  const finalDeals = options.featuredOnly ? filtered.filter((d) => d.isFeatured) : filtered;
  const result = await attachCurrentPrices(supabase, finalDeals.slice(0, limit));

  const categories = Array.from(new Set(result.map((d) => d.dealType)));

  return { deals: result, total: result.length, categories };
}

function mapDealRow(row: Record<string, unknown>): Deal {
  return {
    id: row.id as string,
    productId: row.product_id as string,
    merchantId: row.merchant_id as string | null,
    title: row.title as string,
    description: row.description as string | null,
    dealType: row.deal_type as string,
    discountType: row.discount_type as string,
    discountValue: parseFloat(String(row.discount_value)),
    startAt: row.start_at as string,
    endAt: row.end_at as string,
    couponCode: row.coupon_code as string | null,
    url: row.url as string | null,
    active: row.active as boolean,
  };
}

async function fetchDeals(
  supabase: AnySupabaseClient,
  dealIds: string[]
): Promise<Map<string, Deal>> {
  if (dealIds.length === 0) return new Map();
  const { data } = await supabase
    .from('deals')
    .select('id, product_id, merchant_id, title, description, deal_type, discount_type, discount_value, start_at, end_at, coupon_code, url, active')
    .in('id', dealIds);

  const map = new Map<string, Deal>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    map.set(row.id as string, mapDealRow(row));
  }
  return map;
}

async function fetchProducts(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<Map<string, Product>> {
  if (productIds.length === 0) return new Map();
  const { data } = await supabase
    .from('products')
    .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at')
    .in('id', productIds)
    // The 'sample-laptop' health-check row is not a real product —
    // a deal pointing at it must never render as a deal card.
    .neq('slug', 'sample-laptop')
    .is('deleted_at', null);

  const map = new Map<string, Product>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    map.set(row.id as string, {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      description: row.description as string | null,
      brand: row.brand as string | null,
      category: row.category as string | null,
      imageUrl: row.image_url as string | null,
      gtin: row.gtin as string | null,
      confidenceScore: row.confidence_score as number,
      dataFreshness: row.data_freshness as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    });
  }
  return map;
}

export async function getCachedRankedDeals(
  supabase: AnySupabaseClient,
  options: { dealType?: string; limit?: number; featuredOnly?: boolean }
): Promise<RankedDealsResult> {
  const key = cacheKey('deals-ranked', options.dealType ?? 'all', String(options.limit ?? 20), String(options.featuredOnly ?? false));
  return swrGet<RankedDealsResult>(
    key,
    () => getRankedDeals(supabase, options),
    60_000,
    300_000
  );
}
