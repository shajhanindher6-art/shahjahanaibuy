/**
 * AI recommendation engine service.
 * Generates personalized recommendations based on search history, wishlist,
 * viewed products, and user preferences.
 *
 * S2-7 — SPECIALIZED RECOMMENDER (Master Tool Integration), not the
 * canonical one and not legacy: this is the personalized
 * history/wishlist/views feed behind /api/v1/recommendations (and
 * the smart-deals surface + AI-engine provider routing). The
 * canonical general-purpose recommender is
 * services/personal-assistant.ts (Deal Finder widget, dashboard
 * chat, guided-finder enrichment) — see
 * docs/RECOMMENDER_CANONICAL.md. This module is NOT delegated to
 * it: a personalized feed seeded from a user's own history is a
 * different job from the assistant's query-driven recommendations,
 * and merging them would change what /api/v1/recommendations
 * returns. Do not add a fourth recommender.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { EXCLUDED_SLUGS } from '@/lib/public-products';
import { logger } from '@/lib/config/logger';
import type { Product } from '@/types';
import type { Recommendation, RecommendationContext } from '@/types/ai';
import { getDismissedProductIds } from '@/services/recommendation-feedback';
import { getPersonalizationOptOut } from '@/services/personalization-consent';
import { normalizePriceVerificationStatus } from '@/services/price-verification';

export async function getRecommendations(
  supabase: AnySupabaseClient,
  userId: string,
  limit = 10
): Promise<{ recommendations: Recommendation[]; context: RecommendationContext }> {
  const maxLimit = Math.min(50, Math.max(1, limit));

  try {
    // Section 19, Phase 4 (§12 #43) — personalization opt-out is
    // checked FIRST, and when it is on, NO personal signal is read
    // at all: no search history, no wishlist, no product views, no
    // preferences, no dismissals. The user gets trending-only
    // results with an honest label, and the opt-out is real.
    if (await getPersonalizationOptOut(supabase, userId)) {
      const trending = await getTrendingRecommendations(supabase, maxLimit);
      return {
        recommendations: trending.map((r) => ({
          ...r,
          reason: 'Trending product — personalisation is off for your account',
        })),
        context: { userId, basedOn: 'trending', personalizationOptOut: true },
      };
    }

    const [searchHistory, wishlistItems, productViews, preferences, dismissedIds] =
      await Promise.all([
        getSearchHistoryForRecs(supabase, userId),
        getWishlistForRecs(supabase, userId),
        getProductViewsForRecs(supabase, userId),
        getPreferencesForRecs(supabase, userId),
        // Section 19, Phase 4 (§12 #42) — the feedback loop: ids the
        // user dismissed are excluded below, even if they would
        // otherwise score highest. (Dismissed products are also
        // wishlist items, so the wishlist exclusion below would
        // catch them — this explicit read is what makes the loop
        // testable and robust if that ever changes.)
        getDismissedProductIds(supabase, userId),
      ]);

    const seedCategories = new Set<string>();
    const seedBrands = new Set<string>();
    const excludeProductIds = new Set<string>(dismissedIds);

    for (const entry of searchHistory) {
      const words = entry.query.toLowerCase().split(/\s+/);
      for (const word of words) {
        if (['laptop', 'phone', 'camera', 'watch', 'headphones', 'tablet', 'tv', 'gaming'].includes(word)) {
          seedCategories.add(word);
        }
      }
    }

    for (const item of wishlistItems) {
      if (item.brand) seedBrands.add(item.brand);
      if (item.category) seedCategories.add(item.category.toLowerCase());
      excludeProductIds.add(item.id);
    }

    for (const view of productViews) {
      if (view.brand) seedBrands.add(view.brand);
      if (view.category) seedCategories.add(view.category.toLowerCase());
      excludeProductIds.add(view.id);
    }

    if (preferences) {
      for (const brand of preferences.favoriteBrands) seedBrands.add(brand);
      for (const cat of preferences.favoriteCategories) seedCategories.add(cat.toLowerCase());
    }

    let basedOn: RecommendationContext['basedOn'] = 'trending';
    if (searchHistory.length > 0) basedOn = 'search_history';
    else if (wishlistItems.length > 0) basedOn = 'wishlist';
    else if (productViews.length > 0) basedOn = 'views';
    else if (preferences) basedOn = 'preferences';

    // Section 19, Phase 4 (§12 #40) — the user's budget
    // (user_preferences.budget_min/budget_max) is a signal at last.
    // Prices come from merchant_products (lowest in-stock recorded
    // price per candidate); without a recorded price a product
    // carries no budget claim either way — it is never assumed to
    // be in or over budget.
    const budgetMax = preferences?.budgetMax ?? null;
    const budgetMin = preferences?.budgetMin ?? null;

    let query = supabase
      .from('products')
      .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at')
      .is('deleted_at', null)
      // The Sample Laptop row is a database health-check demo, not
      // a shoppable product — it must never appear as a
      // recommendation (same rule as the chat assistant).
      .neq('slug', EXCLUDED_SLUGS[0]);

    if (excludeProductIds.size > 0) {
      query = query.not('id', 'in', `(${Array.from(excludeProductIds).join(',')})`);
    }

    const orConditions: string[] = [];
    if (seedCategories.size > 0) {
      for (const cat of Array.from(seedCategories)) {
        orConditions.push(`category.ilike.%${cat}%`);
      }
    }
    if (seedBrands.size > 0) {
      for (const brand of Array.from(seedBrands)) {
        orConditions.push(`brand.ilike.%${brand}%`);
      }
    }

    if (orConditions.length > 0) {
      query = query.or(orConditions.join(','));
    }

    // With a budget set, fetch a wider candidate pool (bounded at
    // 50) so in-budget products beyond the top-confidence few still
    // get a chance — the budget filter below runs after the query,
    // and a narrow pool could leave nothing in budget.
    // Section 20, §12 #67 — recommendations are NOT ordered by
    // confidence_score. That column is a field-presence completeness
    // count (name +15, GTIN +20…), floored at 50 — completeness is
    // not product quality, and ordering by it promoted the most
    // complete rows as if they were the best products. Order by
    // recorded views instead (what shoppers actually looked at);
    // the score in buildRecommendation ranks on real signals
    // (brand/category match, budget) after the fetch.
    query = query
      .order('view_count', { ascending: false })
      .limit(budgetMax !== null ? 50 : maxLimit);

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      if (error) logger.warn('getRecommendations: query failed', { error: error.message });

      const trending = await getTrendingRecommendations(supabase, maxLimit);
      return {
        recommendations: trending.filter((r) => !excludeProductIds.has(r.productId)),
        context: { userId, basedOn: 'trending' },
      };
    }

    const products = data as unknown as Array<Record<string, unknown>>;
    const prices = await getLowestPricesForRecs(
      supabase,
      products.map((row) => row.id as string)
    );

    const recommendations: Recommendation[] = [];
    for (const row of products) {
      const product = mapProductRow(row);
      const priceUsd = prices.get(product.id) ?? null;
      // Budget rule (§12 #40): an over-budget product is never
      // recommended silently. When at least one in-budget candidate
      // exists, over-budget products are dropped; when NOTHING fits
      // the budget, they stay — but each carries the over-budget
      // difference in its reason, so the user sees exactly how far
      // over their budget it is.
      const overBudgetByUsd =
        budgetMax !== null && priceUsd !== null && priceUsd > budgetMax
          ? Math.round((priceUsd - budgetMax) * 100) / 100
          : null;
      recommendations.push(
        buildRecommendation(product, {
          seedBrands,
          seedCategories,
          priceUsd,
          // Section 20, §12 #83 — whether ANY personal signal
          // exists for this user (searches, wishlist, views, or
          // preferences). buildRecommendation uses it so a cold
          // user never reads "based on your activity".
          hasActivity: basedOn !== 'trending',
          budgetMin,
          budgetMax,
          overBudgetByUsd,
        })
      );
    }

    let kept = recommendations;
    if (budgetMax !== null) {
      const inBudget = recommendations.filter((r) => r.overBudgetByUsd === null);
      // Products with no recorded price have overBudgetByUsd null
      // (unknown, not over) — they stay in the in-budget set.
      if (inBudget.length > 0) {
        kept = inBudget;
      }
    }

    kept.sort((a, b) => b.score - a.score);

    return {
      recommendations: kept.slice(0, maxLimit),
      context: { userId, basedOn },
    };
  } catch (err) {
    logger.error('getRecommendations: unexpected error', { error: String(err) });
    return { recommendations: [], context: { userId, basedOn: 'trending' } };
  }
}

/** Score + reason one candidate. Budget adds a bonus in-band and an explicit over-budget note out of band. */
function buildRecommendation(
  product: Product,
  input: {
    seedBrands: Set<string>;
    seedCategories: Set<string>;
    priceUsd: number | null;
    budgetMin: number | null;
    budgetMax: number | null;
    overBudgetByUsd: number | null;
    /** True when the user has any personal signal (see call site). */
    hasActivity: boolean;
  }
): Recommendation {
  let score = 50;
  const reasons: string[] = [];

  if (product.brand && input.seedBrands.has(product.brand)) {
    score += 20;
    reasons.push(`matches your favorite brand ${product.brand}`);
  }
  // Section 19, Phase 4 (§12 #48) — the category signal could never
  // fire before this: seeds hold singular keywords ('laptop') or
  // raw categories ('Laptops'), while the old comparison tested
  // `seedCategories.has(category.toLowerCase())` ('laptops') — an
  // exact match that neither form satisfies. Compare case-insensitively
  // with plural tolerance instead ('laptops' contains 'laptop').
  const categoryLower = product.category ? product.category.toLowerCase() : '';
  const categoryMatch =
    categoryLower !== '' &&
    [...input.seedCategories].some(
      (seed) => categoryLower.includes(seed) || seed.includes(categoryLower)
    );
  if (product.category && categoryMatch) {
    score += 15;
    reasons.push(`in ${product.category} which you've shown interest in`);
  }
  if (input.priceUsd !== null && input.budgetMax !== null) {
    if (input.overBudgetByUsd !== null) {
      reasons.push(
        `$${input.overBudgetByUsd.toFixed(2)} over your $${input.budgetMax.toFixed(2)} budget`
      );
    } else if (input.budgetMin === null || input.priceUsd >= input.budgetMin) {
      score += 15;
      reasons.push(`within your $${input.budgetMax.toFixed(2)} budget`);
    }
  }
  // Section 20, §12 #83 — the old fallback claimed "recommended
  // based on your activity" even for cold users with no searches,
  // wishlist, views, or preferences — activity that never happened.
  // Cold users get an honest catalog-pick reason; users WITH
  // activity but no matching signal get a plain "recommended for
  // you" (no false activity claim either way).
  if (reasons.length === 0) {
    reasons.push(
      input.hasActivity
        ? 'Recommended for you'
        : 'Catalog pick — no activity recorded for your account yet'
    );
  }

  return {
    productId: product.id,
    product,
    score: Math.min(100, score),
    reason: reasons.join(', '),
    priceUsd: input.priceUsd,
    overBudgetByUsd: input.overBudgetByUsd,
  };
}

/** Trending fallback, shared by the opt-out path and the query-failure path. */
async function getTrendingRecommendations(
  supabase: AnySupabaseClient,
  maxLimit: number
): Promise<Recommendation[]> {
  const { data: trending } = await supabase
    .from('products')
    .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, view_count, created_at, updated_at')
    .is('deleted_at', null)
    .neq('slug', EXCLUDED_SLUGS[0])
    .order('view_count', { ascending: false })
    .limit(maxLimit);

  const trendingProducts = (trending ?? []) as unknown as Array<Record<string, unknown>>;
  // Section 20, §12 #83 — "popular with other shoppers" is only
  // said when the product actually has recorded views. Live view
  // counts are ~0, so an unqualified popularity claim would be an
  // assertion from no evidence; view-less rows get the honest
  // catalog-pick reason instead.
  return trendingProducts.map((row) => ({
    productId: row.id as string,
    product: mapProductRow(row),
    score: 50,
    reason:
      typeof row.view_count === 'number' && row.view_count > 0
        ? 'Trending product popular with other shoppers'
        : 'Trending product — catalog pick (no views recorded yet)',
  }));
}

/** Lowest recorded in-stock merchant price per product id (one batched query). */
async function getLowestPricesForRecs(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (ids.length === 0) return prices;
  try {
    const { data, error } = await supabase
      .from('merchant_products')
      .select('product_id, price')
      .in('product_id', ids)
      .eq('in_stock', true)
      .order('price', { ascending: true });
    if (error || !data) return prices;
    for (const row of data as Array<Record<string, unknown>>) {
      const pid = row.product_id as string;
      const price = parseFloat(String(row.price));
      if (!pid || !Number.isFinite(price) || price <= 0) continue;
      if (!prices.has(pid)) prices.set(pid, price);
    }
  } catch {
    return prices;
  }
  return prices;
}

function mapProductRow(row: Record<string, unknown>): Product {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    description: row.description as string | null,
    brand: row.brand as string | null,
    category: row.category as string | null,
    imageUrl: row.image_url as string | null,
    gtin: row.gtin as string | null,
    // Final 100% — F-P2-03: the legacy `confidence_score`
    // (field-presence count, floored at 50) is NOT emitted on
    // the Product object any more — getRecommendations serializes
    // it into /api/v1/recommendations. Internal readers must use
    // the 7-dimension data-quality score instead.
    // Section 20, §12 #82 — populate the verification rollup (see
    // ai-deals.ts: the 045 column is not selected yet, so this reads
    // 'unverified' until 045 applies and the select grows).
    priceVerificationStatus: normalizePriceVerificationStatus(
      row.price_verification_status
    ),
    dataFreshness: row.data_freshness as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

async function getSearchHistoryForRecs(
  supabase: AnySupabaseClient,
  userId: string
): Promise<Array<{ query: string }>> {
  const { data } = await supabase
    .from('search_history')
    .select('query')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  return (data ?? []) as Array<{ query: string }>;
}

async function getWishlistForRecs(
  supabase: AnySupabaseClient,
  userId: string
): Promise<Array<{ id: string; brand: string | null; category: string | null }>> {
  const { data: wishlists } = await supabase
    .from('wishlists')
    .select('id')
    .eq('user_id', userId);

  if (!wishlists || wishlists.length === 0) return [];

  const wishlistIds = wishlists.map((w) => (w as Record<string, unknown>).id as string);
  const { data: items } = await supabase
    .from('wishlist_items')
    .select('product_id')
    .in('wishlist_id', wishlistIds);

  if (!items || items.length === 0) return [];

  const productIds = items.map((i) => (i as Record<string, unknown>).product_id as string);
  const { data: products } = await supabase
    .from('products')
    .select('id, brand, category')
    .in('id', productIds)
    .is('deleted_at', null);

  return (products ?? []) as Array<{ id: string; brand: string | null; category: string | null }>;
}

async function getProductViewsForRecs(
  supabase: AnySupabaseClient,
  userId: string
): Promise<Array<{ id: string; brand: string | null; category: string | null }>> {
  const { data: views } = await supabase
    .from('product_views')
    .select('product_id')
    .eq('user_id', userId)
    .order('viewed_at', { ascending: false })
    .limit(20);

  if (!views || views.length === 0) return [];

  const productIds = views.map((v) => (v as Record<string, unknown>).product_id as string);
  const { data: products } = await supabase
    .from('products')
    .select('id, brand, category')
    .in('id', productIds)
    .is('deleted_at', null);

  return (products ?? []) as Array<{ id: string; brand: string | null; category: string | null }>;
}

async function getPreferencesForRecs(
  supabase: AnySupabaseClient,
  userId: string
): Promise<{
  favoriteBrands: string[];
  favoriteCategories: string[];
  /** Section 19, Phase 4 (§12 #40) — the budget signal. */
  budgetMin: number | null;
  budgetMax: number | null;
} | null> {
  const { data } = await supabase
    .from('user_preferences')
    .select('favorite_brands, favorite_categories, budget_min, budget_max')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return null;
  const row = data as Record<string, unknown>;
  const toBudget = (value: unknown): number | null => {
    const n = typeof value === 'string' ? parseFloat(value) : (value as number);
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    favoriteBrands: (row.favorite_brands as string[]) ?? [],
    favoriteCategories: (row.favorite_categories as string[]) ?? [],
    budgetMin: toBudget(row.budget_min),
    budgetMax: toBudget(row.budget_max),
  };
}
