/**
 * API v1 dashboard digest endpoint (Enterprise #13).
 * GET /api/v1/dashboard/digest — the signed-in user's personal
 * shopping digest: saved items (wishlist) with current prices,
 * active price-drop alerts with trigger status, and vector-matched
 * recommendations based on what they track.
 *
 * Auth required and owner-scoped (requireAuth + getUserTracking,
 * same pattern as drops-to-watch / landed-cost). The saved-items
 * and alerts sections never fail the whole digest: only the
 * recommendations leg is best-effort (it needs HF_API_TOKEN and
 * stored embeddings), and any failure there degrades to an honest
 * empty list + note, never a 500.
 *
 * Recommendations (vector leg): for up to 3 tracked products, the
 * product text is embedded (MiniLM, same shape as the backfill)
 * and matched against product_embeddings. Matches need similarity
 * >= 0.80 ("similar", never a "95%+ match" claim), exclude the
 * source products and anything already saved, and carry a real
 * lowest price. Dormant until the owner runs the backfill — the
 * note says so honestly.
 */

import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { getUserTracking, type TrackedAlert, type TrackedItem } from '@/services/tracking';
import {
  DIGEST_RECOMMENDATION_MAX,
  DIGEST_RECOMMENDATION_MIN_SIMILARITY,
  DIGEST_RECOMMENDATION_SOURCES,
  selectVectorRecommendations,
  type BudgetAlternativeCandidate,
  type VectorRecommendation,
} from '@/services/alternative-recommender';
import { embedText, isVectorSearchConfigured, productEmbeddingText } from '@/services/visual-search';
import { getMerchantProducts } from '@/services/commerce';
import { logger } from '@/lib/config/logger';

export interface DigestSavedItem {
  itemId: string;
  productId: string;
  productName: string;
  productSlug: string;
  brand: string | null;
  wishlistName: string;
  targetPrice: number | null;
  currentPrice: number | null;
  changePct: number | null;
  belowTarget: boolean;
}

export interface DigestAlert {
  id: string;
  productId: string;
  productName: string;
  productSlug: string | null;
  alertType: string;
  conditionValue: number | null;
  channel: string;
  active: boolean;
  lastTriggeredAt: string | null;
  triggerCount: number;
}

export interface DigestData {
  savedItems: DigestSavedItem[];
  alerts: DigestAlert[];
  recommendations: VectorRecommendation[];
  recommendationsNote: string | null;
  summary: {
    savedCount: number;
    activeAlerts: number;
    belowTarget: number;
    recommendationsCount: number;
  };
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205';
}

/**
 * Best-effort vector leg: embed up to 3 tracked products and
 * match each against the catalog. Any failure (no token, missing
 * table, HF error, no matches) returns [] + an honest note —
 * never throws, so the digest still serves saved items + alerts.
 */
async function vectorRecommendations(
  service: SupabaseClient | null,
  items: TrackedItem[]
): Promise<{ recommendations: VectorRecommendation[]; note: string | null }> {
  const empty = (note: string): { recommendations: VectorRecommendation[]; note: string } => ({
    recommendations: [],
    note,
  });
  if (items.length === 0) {
    return empty('Save products to your wishlist to get similar-product recommendations.');
  }
  if (!isVectorSearchConfigured()) {
    return empty(
      'Similar-product recommendations are not configured yet (HF_API_TOKEN not set). Save products and they will appear here once vector search is enabled.'
    );
  }
  if (!service) {
    return empty('Similar-product recommendations are unavailable right now (database service client unavailable).');
  }

  const sources = items.slice(0, DIGEST_RECOMMENDATION_SOURCES);
  const sourceIds = new Set(items.map((i) => i.product.id));

  // Product descriptions for the embedding text (tracking items
  // do not carry them). Missing descriptions degrade to name +
  // brand — never a guessed description.
  const { data: products, error: productsError } = await service
    .from('products')
    .select('id, name, brand, description')
    .in(
      'id',
      sources.map((s) => s.product.id)
    )
    .is('deleted_at', null);
  if (productsError || !products) {
    logger.warn('digest: product lookup for recommendations failed', {
      error: productsError?.message,
    });
    return empty('Similar-product recommendations are unavailable right now.');
  }
  const byId = new Map(
    ((products ?? []) as Array<{ id: string; name: string; brand: string | null; description: string | null }>).map(
      (p) => [p.id, p]
    )
  );

  const perSource = await Promise.all(
    sources.map(async (item) => {
      const product = byId.get(item.product.id);
      if (!product) return [];
      const embedded = await embedText(
        productEmbeddingText({ name: product.name, brand: product.brand, description: product.description })
      );
      if (!embedded.ok) {
        logger.warn('digest: embedding failed for recommendation source', { error: embedded.error });
        return [];
      }
      const { data: rpcData, error: rpcError } = await service.rpc('match_products', {
        query_embedding: embedded.value,
        match_count: 5,
      });
      if (rpcError) {
        if (!isMissingTableError(rpcError)) {
          logger.warn('digest: match_products failed', { error: rpcError.message });
        }
        return [];
      }
      return (Array.isArray(rpcData) ? rpcData : []) as Array<{ product_id: string; similarity: number }>;
    })
  );

  // Enrich all matched ids (dedupe first) with product details +
  // real lowest prices. A missing table surfaces as the dormant
  // note, not an error — the embeddings simply are not there yet.
  const matchedIds = Array.from(new Set(perSource.flat().map((m) => m.product_id)));
  if (matchedIds.length === 0) {
    return empty(
      'No similar products yet — the catalog has no product embeddings. An admin needs to run the backfill once (see docs/visual-search.md).'
    );
  }
  const { data: matchedProducts, error: matchedError } = await service
    .from('products')
    .select('id, slug, name, brand')
    .in('id', matchedIds)
    .is('deleted_at', null);
  if (matchedError) {
    if (isMissingTableError(matchedError)) {
      return empty(
        'No similar products yet — the catalog has no product embeddings. An admin needs to run the backfill once (see docs/visual-search.md).'
      );
    }
    logger.warn('digest: recommendation product lookup failed', { error: matchedError.message });
    return empty('Similar-product recommendations are unavailable right now.');
  }
  const matchedById = new Map(
    ((matchedProducts ?? []) as Array<{ id: string; slug: string; name: string; brand: string | null }>).map((p) => [
      p.id,
      p,
    ])
  );

  const candidates: Array<
    BudgetAlternativeCandidate & { basedOnProductId: string; basedOnProductName: string }
  > = [];
  for (let s = 0; s < sources.length; s++) {
    const source = sources[s];
    for (const match of perSource[s] ?? []) {
      const product = matchedById.get(match.product_id);
      if (!product) continue;
      let lowestPriceUsd: number | null = null;
      try {
        const listings = await getMerchantProducts(service, product.id);
        if (listings.length > 0 && Number.isFinite(listings[0].price)) {
          lowestPriceUsd = listings[0].price;
        }
      } catch {
        lowestPriceUsd = null;
      }
      candidates.push({
        id: product.id,
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        similarity: match.similarity,
        lowestPriceUsd,
        basedOnProductId: source.product.id,
        basedOnProductName: source.product.name,
      });
    }
  }

  const recommendations = selectVectorRecommendations(
    candidates,
    sourceIds,
    DIGEST_RECOMMENDATION_MIN_SIMILARITY,
    DIGEST_RECOMMENDATION_MAX
  );
  if (recommendations.length === 0) {
    return empty(
      'No similar products found for your saved items yet — try saving more products, or check back after the catalog embeddings are built.'
    );
  }
  return { recommendations, note: null };
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'dashboard.digest' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const tracking = await getUserTracking(supabase, auth.userId);

    const savedItems: DigestSavedItem[] = tracking.items.map((item) => ({
      itemId: item.itemId,
      productId: item.product.id,
      productName: item.product.name,
      productSlug: item.product.slug,
      brand: item.product.brand,
      wishlistName: item.wishlistName,
      targetPrice: item.targetPrice,
      currentPrice: item.currentPrice,
      changePct: item.changePct,
      belowTarget: item.belowTarget,
    }));

    const alerts: DigestAlert[] = tracking.alerts.map((a: TrackedAlert) => ({
      id: a.id,
      productId: a.productId,
      productName: a.productName,
      productSlug: a.productSlug,
      alertType: a.alertType,
      conditionValue: a.conditionValue,
      channel: a.channel,
      active: a.active,
      lastTriggeredAt: a.lastTriggeredAt,
      triggerCount: a.triggerCount,
    }));

    // Vector leg is best-effort: it never fails the digest.
    const service = createSupabaseServiceClient();
    const { recommendations, note } = await vectorRecommendations(service, tracking.items);

    const data: DigestData = {
      savedItems,
      alerts,
      recommendations,
      recommendationsNote: note,
      summary: {
        savedCount: savedItems.length,
        activeAlerts: alerts.filter((a) => a.active).length,
        belowTarget: savedItems.filter((i) => i.belowTarget).length,
        recommendationsCount: recommendations.length,
      },
    };
    return apiSuccess(data, 200, {
      trackedCount: tracking.items.length,
      alertCount: alerts.length,
    });
  } catch {
    return internalError('Failed to fetch your shopping digest');
  }
}
