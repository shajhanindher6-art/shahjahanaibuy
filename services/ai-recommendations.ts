/**
 * AI recommendation engine service.
 * Generates personalized recommendations based on search history, wishlist,
 * viewed products, and user preferences.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { Product } from '@/types';
import type { Recommendation, RecommendationContext } from '@/types/ai';

export async function getRecommendations(
  supabase: AnySupabaseClient,
  userId: string,
  limit = 10
): Promise<{ recommendations: Recommendation[]; context: RecommendationContext }> {
  const maxLimit = Math.min(50, Math.max(1, limit));

  try {
    const [searchHistory, wishlistItems, productViews, preferences] = await Promise.all([
      getSearchHistoryForRecs(supabase, userId),
      getWishlistForRecs(supabase, userId),
      getProductViewsForRecs(supabase, userId),
      getPreferencesForRecs(supabase, userId),
    ]);

    const seedCategories = new Set<string>();
    const seedBrands = new Set<string>();
    const excludeProductIds = new Set<string>();

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
      if (item.category) seedCategories.add(item.category);
      excludeProductIds.add(item.id);
    }

    for (const view of productViews) {
      if (view.brand) seedBrands.add(view.brand);
      if (view.category) seedCategories.add(view.category);
      excludeProductIds.add(view.id);
    }

    if (preferences) {
      for (const brand of preferences.favoriteBrands) seedBrands.add(brand);
      for (const cat of preferences.favoriteCategories) seedCategories.add(cat);
    }

    let basedOn: RecommendationContext['basedOn'] = 'trending';
    if (searchHistory.length > 0) basedOn = 'search_history';
    else if (wishlistItems.length > 0) basedOn = 'wishlist';
    else if (productViews.length > 0) basedOn = 'views';
    else if (preferences) basedOn = 'preferences';

    let query = supabase
      .from('products')
      .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at')
      .is('deleted_at', null);

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

    query = query
      .order('confidence_score', { ascending: false })
      .order('view_count', { ascending: false })
      .limit(maxLimit);

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      if (error) logger.warn('getRecommendations: query failed', { error: error.message });

      const { data: trending } = await supabase
        .from('products')
        .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at')
        .is('deleted_at', null)
        .order('view_count', { ascending: false })
        .limit(maxLimit);

      const trendingProducts = (trending ?? []) as unknown as Array<Record<string, unknown>>;
      return {
        recommendations: trendingProducts.map((row) => ({
          productId: row.id as string,
          product: mapProductRow(row),
          score: 50,
          reason: 'Trending product popular with other shoppers',
        })),
        context: { userId, basedOn: 'trending' },
      };
    }

    const products = data as unknown as Array<Record<string, unknown>>;
    const recommendations: Recommendation[] = products.map((row) => {
      const product = mapProductRow(row);
      let score = 50;
      const reasons: string[] = [];

      if (product.brand && seedBrands.has(product.brand)) {
        score += 20;
        reasons.push(`matches your favorite brand ${product.brand}`);
      }
      if (product.category && seedCategories.has(product.category.toLowerCase())) {
        score += 15;
        reasons.push(`in ${product.category} which you've shown interest in`);
      }
      if (reasons.length === 0) reasons.push('recommended based on your activity');

      return {
        productId: product.id,
        product,
        score: Math.min(100, score),
        reason: reasons.join(', '),
      };
    });

    recommendations.sort((a, b) => b.score - a.score);

    return {
      recommendations,
      context: { userId, basedOn },
    };
  } catch (err) {
    logger.error('getRecommendations: unexpected error', { error: String(err) });
    return { recommendations: [], context: { userId, basedOn: 'trending' } };
  }
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
    confidenceScore: row.confidence_score as number,
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
): Promise<{ favoriteBrands: string[]; favoriteCategories: string[] } | null> {
  const { data } = await supabase
    .from('user_preferences')
    .select('favorite_brands, favorite_categories')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    favoriteBrands: (row.favorite_brands as string[]) ?? [],
    favoriteCategories: (row.favorite_categories as string[]) ?? [],
  };
}
