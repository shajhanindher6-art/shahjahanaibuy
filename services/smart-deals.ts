/**
 * Smart Deal Recommendations — the widget's ranking, not a new deal source.
 *
 * It reuses the deals that already exist instead of inventing discounts:
 *   - Ranked deals from services/ai-deals.ts (deal_rankings, or freshly
 *     computed from the active `deals` table when no rankings exist).
 *   - Trending signal: the product's `view_count` (incremented on every
 *     product detail view, migration 004).
 *   - User activity, when a user is signed in: the product IDs, brands
 *     and categories from services/ai-recommendations.ts (search
 *     history, wishlist, views, preferences). Guests get the trending
 *     ranking only — no activity is assumed for them.
 *
 * Transparent score (used only to sort, and returned for debugging):
 *   aiScore + discountPercentage * 0.25 + trendingBoost (0–10 from
 *   view_count relative to the most-viewed deal product) + 15 when
 *   the product, its brand, or its category matches the user's
 *   activity. Every `reason` string is built from those same real
 *   fields, never from a claimed discount that is not in the deal row.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { getRankedDeals } from './ai-deals';
import { getRecommendations } from './ai-recommendations';

export interface SmartDeal {
  dealId: string | null;
  productId: string | null;
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
  } | null;
  dealType: string;
  discountPercentage: number;
  savingsAmount: number;
  aiScore: number;
  score: number;
  reason: string;
  isFeatured: boolean;
  couponCode: string | null;
  endAt: string | null;
}

export interface SmartDealsResult {
  deals: SmartDeal[];
  basedOn: 'personalized' | 'trending';
}

export async function getSmartDealRecommendations(
  supabase: AnySupabaseClient,
  userId: string | null,
  limit = 6
): Promise<SmartDealsResult> {
  const maxLimit = Math.min(12, Math.max(1, limit));
  try {
    const ranked = await getRankedDeals(supabase, { limit: maxLimit * 3 });
    if (ranked.deals.length === 0) return { deals: [], basedOn: 'trending' };

    // Personal activity seeds (signed-in users only).
    const personalProductIds = new Set<string>();
    const personalBrands = new Set<string>();
    const personalCategories = new Set<string>();
    let basedOn: SmartDealsResult['basedOn'] = 'trending';
    if (userId) {
      try {
        const { recommendations, context } = await getRecommendations(supabase, userId, 20);
        if (recommendations.length > 0) {
          basedOn = 'personalized';
          for (const rec of recommendations) {
            if (rec.productId) personalProductIds.add(rec.productId);
            if (rec.product?.brand) personalBrands.add(rec.product.brand.toLowerCase());
            if (rec.product?.category) personalCategories.add(rec.product.category.toLowerCase());
          }
        } else if (context.basedOn !== 'trending') {
          basedOn = 'personalized';
        }
      } catch {
        // Personalization is a boost, not a requirement: a failed
        // recommendations lookup must not empty the widget.
      }
    }

    // Trending signal for the deal products.
    const productIds = ranked.deals.map((d) => d.productId).filter(Boolean) as string[];
    const viewCountById = new Map<string, number>();
    if (productIds.length > 0) {
      const { data } = await supabase
        .from('products')
        .select('id, view_count')
        .in('id', productIds);
      for (const row of (data ?? []) as Array<{ id: string; view_count: number | null }>) {
        viewCountById.set(row.id, row.view_count ?? 0);
      }
    }
    const maxViews = Math.max(1, ...Array.from(viewCountById.values()));

    const deals: SmartDeal[] = ranked.deals
      .filter((d) => d.product)
      .map((d) => {
        const product = d.product!;
        const views = viewCountById.get(product.id) ?? 0;
        const trendingBoost = (views / maxViews) * 10;
        const isPersonal =
          personalProductIds.has(product.id) ||
          (product.brand ? personalBrands.has(product.brand.toLowerCase()) : false) ||
          (product.category ? personalCategories.has(product.category.toLowerCase()) : false);
        const personalBoost = isPersonal ? 15 : 0;
        const score = d.aiScore + d.discountPercentage * 0.25 + trendingBoost + personalBoost;

        const reasons: string[] = [];
        if (isPersonal) reasons.push('Matches your recent activity');
        if (d.discountPercentage > 0) reasons.push(`${Math.round(d.discountPercentage)}% off`);
        if (d.savingsAmount > 0) reasons.push(`Save $${d.savingsAmount.toFixed(2)}`);
        if (views >= maxViews * 0.5 && views > 0) reasons.push('Trending now');
        if (d.dealType === 'flash') reasons.push('Flash deal — ends soon');
        if (reasons.length === 0) reasons.push('Top-ranked deal');

        return {
          dealId: d.dealId,
          productId: d.productId,
          product: {
            id: product.id,
            name: product.name,
            slug: product.slug,
            brand: product.brand,
            category: product.category,
            imageUrl: product.imageUrl,
          },
          dealType: d.dealType,
          discountPercentage: d.discountPercentage,
          savingsAmount: d.savingsAmount,
          aiScore: d.aiScore,
          score: Math.round(score * 10) / 10,
          reason: reasons.join(' · '),
          isFeatured: d.isFeatured,
          couponCode: d.deal?.couponCode ?? null,
          endAt: d.deal?.endAt ?? null,
        };
      });

    deals.sort((a, b) => b.score - a.score);
    return { deals: deals.slice(0, maxLimit), basedOn };
  } catch (err) {
    logger.error('getSmartDealRecommendations: unexpected error', { error: String(err) });
    return { deals: [], basedOn: 'trending' };
  }
}
