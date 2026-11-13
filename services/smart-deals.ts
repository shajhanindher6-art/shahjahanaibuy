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
 *
 * Section 21, Stage E (E-P1-2) — the discountPercentage * 0.25
 * term counts ONLY when the row's discount validation passed
 * ('validated', see services/ai-deals.ts): an unvalidated claimed
 * discount must not rank here either. The aiScore term already
 * carries the same gate (its own claimed-discount terms are 0
 * unless validated), so this widget no longer double-counts an
 * unvalidated claim.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { getCachedRankedDeals } from './ai-deals';
import { getRecommendations } from './ai-recommendations';
import { recordAiRecommendation } from './ai-recommendation-audit';

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
  /** Latest recorded price in USD, or null when none is recorded. */
  currentPrice: number | null;
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
    // Cached ranking (60s fresh / 300s stale in-memory) so repeat
    // homepage loads do not re-run the full ranking query every time.
    const ranked = await getCachedRankedDeals(supabase, { limit: maxLimit * 3 });
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
        // Section 19, Phase 0 (§12 #24): a null percentage (fixed
        // deal, no recorded price) contributes 0 to the score and
        // shows no "% off" reason — never a fabricated number.
        // Section 21, Stage E (E-P1-2): the claimed-discount
        // term counts ONLY when the discount validated against
        // recorded history — an unvalidated claim must not rank.
        const discountPct = d.discountPercentage ?? 0;
        const discountValidated = d.discountValidation?.status === 'validated';
        const score =
          d.aiScore +
          (discountValidated ? discountPct * 0.25 : 0) +
          trendingBoost +
          personalBoost;

        const reasons: string[] = [];
        if (isPersonal) reasons.push('Matches your recent activity');
        // Sections 21–25, Stage H (H-P2-1) — the "% off" reason is
        // a CLAIMED discount: it prints only when the discount
        // validated against recorded history (same gate as the
        // score term above), and it is qualified "vs list price"
        // — never a bare "% off" from an unobserved list price.
        if (discountPct > 0 && discountValidated)
          reasons.push(`${Math.round(discountPct)}% off vs list price`);
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
          discountPercentage: discountPct,
          savingsAmount: d.savingsAmount,
          currentPrice: d.currentPrice ?? null,
          aiScore: d.aiScore,
          score: Math.round(score * 10) / 10,
          reason: reasons.join(' · '),
          isFeatured: d.isFeatured,
          couponCode: d.deal?.couponCode ?? null,
          endAt: d.deal?.endAt ?? null,
        };
      });

    deals.sort((a, b) => b.score - a.score);
    // Guests used to see a reason that was just the discount repeated
    // ("20% off") because no personal or trending-view signal fired.
    // The top 3 of a trending ranking genuinely are top trending
    // picks, so say so — a distinct reason, not an invented claim.
    const sliced = deals.slice(0, maxLimit).map((d, i) =>
      basedOn === 'trending' && i < 3 && !d.reason.includes('Trending')
        ? { ...d, reason: `${d.reason} · Top trending pick` }
        : d
    );
    // Section 21, Stage E (E-P1-4) — audit the smart-deal picks:
    // the signed-in user id when known (null = guest), the top
    // picks, and the validation basis of the top pick. The
    // recorder never throws; its durable write no-ops until
    // migration 065 applies.
    recordAiRecommendation(supabase, {
      surface: 'smart-deals',
      userId,
      productIds: sliced
        .slice(0, 3)
        .map((d) => d.productId)
        .filter((id): id is string => typeof id === 'string'),
      recommendation: `Smart deal picks: ${sliced
        .slice(0, 3)
        .map((d) => d.product?.name ?? 'deal')
        .join(', ')}`,
      basis: {
        discountValidationStatus:
          ranked.deals.find((r) => r.productId === sliced[0]?.productId)
            ?.discountValidation?.status ?? null,
      },
    });
    return { deals: sliced, basedOn };
  } catch (err) {
    logger.error('getSmartDealRecommendations: unexpected error', { error: String(err) });
    return { deals: [], basedOn: 'trending' };
  }
}
