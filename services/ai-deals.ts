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

export interface RankedDealsResult {
  deals: Array<DealRanking & { deal: Deal | null; product: Product | null; currentPrice: number | null }>;
  total: number;
  categories: string[];
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
    let query = supabase
      .from('deal_rankings')
      .select('*')
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

    return { deals: dealsWithPrices, total: dealsWithPrices.length, categories };
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
  const productIds = deals.map((d) => d.product_id as string).filter(Boolean);
  const productsMap = await fetchProducts(supabase, productIds as string[]);

  const ranked: Array<DealRanking & { deal: Deal | null; product: Product | null; currentPrice: number | null }> = [];
  const now = new Date();

  for (const dRow of deals) {
    const deal = mapDealRow(dRow);
    const productId = dRow.product_id as string | null;
    const product = productId ? (productsMap.get(productId) ?? null) : null;

    const discountPercentage = deal.discountType === 'percentage'
      ? deal.discountValue
      : deal.discountType === 'fixed' && product
        ? (deal.discountValue / 100) * 10
        : 0;

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

    let aiScore = 50;
    aiScore += discountPercentage * 0.5;
    if (isFlash) aiScore += 20;
    if (deal.discountValue >= 30) aiScore += 15;
    if (product && product.confidenceScore >= 70) aiScore += 10;
    aiScore = Math.min(100, aiScore);

    const isFeatured = aiScore >= 75;

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
    });

    void supabase.from('deal_rankings').insert({
      deal_id: deal.id,
      product_id: productId,
      deal_type: dealType,
      ai_score: aiScore,
      discount_percentage: discountPercentage,
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
