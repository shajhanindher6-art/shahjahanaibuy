/**
 * Budget alternative recommender (Enterprise #12) + vector
 * recommendations for the shopping digest (#13).
 *
 * S2-7 — SPECIALIZED RECOMMENDER (Master Tool Integration), not the
 * canonical one and not legacy: this is the vector-similarity
 * surface — budget alternatives for a product page
 * (/api/v1/products/[slug]/budget-alternative) and digest picks
 * (/api/v1/dashboard/digest). The canonical general-purpose
 * recommender is services/personal-assistant.ts — see
 * docs/RECOMMENDER_CANONICAL.md. This module is NOT delegated to
 * it: cosine-similarity matching against product embeddings, with
 * its documented 0.95 / 0.80 bars, is a different job from the
 * assistant's query-driven recommendations, and merging them would
 * change what the budget-alternative and digest routes return. Do
 * not add a fourth recommender.
 *
 * RULES (do not weaken without a new decision):
 * - A "95%+ match" is ONLY ever claimed when the real cosine
 *   similarity from match_products() is >= 0.95. The threshold is
 *   never relaxed, rounded up, or fudged: 0.949 is not 0.95.
 * - An alternative must also have a REAL lowest recorded price
 *   (from merchant_products, via getMerchantProducts) that is
 *   within the shopper's budget. No price = no alternative, never
 *   a guessed price. The source product itself is always excluded
 *   (its own embedding matches itself at ~1.0).
 * - When the embeddings table is empty or missing (dormant until
 *   the owner runs the backfill), the result is an honest empty —
 *   never a fake alternative. Same when HF_API_TOKEN is unset.
 * - Digest recommendations (#13) use a lower, documented bar
 *   (>= 0.80, "similar", never "95%+ match") and are capped, so a
 *   digest never turns into an invented shopping list.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import { getMerchantProducts } from '@/services/commerce';
import { embedText, isVectorSearchConfigured, productEmbeddingText } from '@/services/visual-search';
import { logger } from '@/lib/config/logger';

/** Minimum cosine similarity for a "95%+ match" claim. */
export const BUDGET_ALTERNATIVE_MIN_SIMILARITY = 0.95;
/** How many RPC matches to consider before filtering by budget. */
export const BUDGET_ALTERNATIVE_MATCH_COUNT = 10;

/** Minimum cosine similarity for a digest "similar" recommendation. */
export const DIGEST_RECOMMENDATION_MIN_SIMILARITY = 0.8;
/** Max recommendations in one digest. */
export const DIGEST_RECOMMENDATION_MAX = 6;
/** Max saved products the digest embeds per load (one HF call each). */
export const DIGEST_RECOMMENDATION_SOURCES = 3;

export interface BudgetAlternativeCandidate {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  /** Real cosine similarity from the RPC, rounded to 3 decimals. */
  similarity: number;
  /** Real lowest recorded merchant price, or null when unpriced. */
  lowestPriceUsd: number | null;
}

export interface BudgetAlternative {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  similarity: number;
  lowestPriceUsd: number;
}

export type BudgetAlternativeReason =
  | 'ok'
  | 'within-budget'
  | 'not-configured'
  | 'embeddings-empty'
  | 'none-within-budget'
  | 'source-not-found'
  | 'error';

export interface BudgetAlternativeResult {
  alternative: BudgetAlternative | null;
  reason: BudgetAlternativeReason;
  sourceProductId: string;
  /** Real lowest recorded price of the source product, when known. */
  sourceLowestPriceUsd: number | null;
  budgetUsd: number;
  /** Human-readable note for the route to surface (never invented). */
  note: string | null;
}

export interface VectorRecommendation {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  similarity: number;
  lowestPriceUsd: number;
  basedOnProductId: string;
  basedOnProductName: string;
}

/**
 * Pure selection (unit-testable, no I/O): from RPC matches enriched
 * with real lowest prices, keep only similarity >= 0.95 AND a real
 * price within budget, best similarity first. Returns the best, or
 * null. The threshold is a hard >= — 0.949 does not pass.
 */
export function selectBudgetAlternative(
  candidates: BudgetAlternativeCandidate[],
  budgetUsd: number
): BudgetAlternative | null {
  const within = candidates
    .filter(
      (c) =>
        c.similarity >= BUDGET_ALTERNATIVE_MIN_SIMILARITY &&
        c.lowestPriceUsd !== null &&
        Number.isFinite(c.lowestPriceUsd) &&
        c.lowestPriceUsd <= budgetUsd
    )
    .sort((a, b) => b.similarity - a.similarity);
  const best = within[0];
  if (!best || best.lowestPriceUsd === null) return null;
  return {
    id: best.id,
    slug: best.slug,
    name: best.name,
    brand: best.brand,
    similarity: Math.round(best.similarity * 1000) / 1000,
    lowestPriceUsd: best.lowestPriceUsd,
  };
}

/**
 * Pure selection for digest recommendations (unit-testable, no I/O):
 * dedupe by product id keeping the highest similarity, drop
 * excluded ids (the source products and anything already saved),
 * keep similarity >= minSimilarity AND a real price, best first,
 * capped at `limit`. Returns [] — never an invented recommendation.
 */
export function selectVectorRecommendations(
  candidates: Array<
    BudgetAlternativeCandidate & { basedOnProductId: string; basedOnProductName: string }
  >,
  excludeIds: ReadonlySet<string>,
  minSimilarity: number = DIGEST_RECOMMENDATION_MIN_SIMILARITY,
  limit: number = DIGEST_RECOMMENDATION_MAX
): VectorRecommendation[] {
  const bestById = new Map<string, VectorRecommendation>();
  for (const c of candidates) {
    if (excludeIds.has(c.id)) continue;
    if (c.similarity < minSimilarity) continue;
    if (c.lowestPriceUsd === null || !Number.isFinite(c.lowestPriceUsd)) continue;
    const existing = bestById.get(c.id);
    const rec: VectorRecommendation = {
      id: c.id,
      slug: c.slug,
      name: c.name,
      brand: c.brand,
      similarity: Math.round(c.similarity * 1000) / 1000,
      lowestPriceUsd: c.lowestPriceUsd,
      basedOnProductId: c.basedOnProductId,
      basedOnProductName: c.basedOnProductName,
    };
    if (!existing || rec.similarity > existing.similarity) bestById.set(c.id, rec);
  }
  return [...bestById.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, Math.max(0, limit));
}

interface RpcMatch {
  product_id: string;
  similarity: number;
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205';
}

async function lowestPrice(
  service: AnySupabaseClient,
  productId: string
): Promise<number | null> {
  try {
    const listings = await getMerchantProducts(service, productId);
    if (listings.length > 0 && Number.isFinite(listings[0].price)) {
      return listings[0].price;
    }
  } catch {
    // Price lookup failure degrades to null — never an invented price.
  }
  return null;
}

interface SourceProduct {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  description: string | null;
}

async function loadSourceProduct(
  service: SupabaseClient,
  sourceProductId: string
): Promise<SourceProduct | null> {
  const { data, error } = await service
    .from('products')
    .select('id, slug, name, brand, description')
    .eq('id', sourceProductId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    brand: (row.brand as string | null) ?? null,
    description: (row.description as string | null) ?? null,
  };
}

/**
 * Server function: find a vector-matched alternative to
 * `sourceProductId` that is within `budgetUsd`.
 *
 * Flow: source product → embed its name/brand/description →
 * match_products RPC → exclude the source itself → enrich with
 * real lowest prices → pure threshold + budget selection.
 * Short-circuits BEFORE spending an HF call when the source's own
 * lowest price is already within budget ('within-budget').
 */
export async function findBudgetAlternative(
  service: SupabaseClient,
  sourceProductId: string,
  budgetUsd: number
): Promise<BudgetAlternativeResult> {
  const base = {
    sourceProductId,
    budgetUsd,
    sourceLowestPriceUsd: null as number | null,
  };
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return { ...base, alternative: null, reason: 'error', note: 'Budget must be a positive number.' };
  }
  if (!isVectorSearchConfigured()) {
    return {
      ...base,
      alternative: null,
      reason: 'not-configured',
      note: 'Vector alternatives are not configured yet (HF_API_TOKEN not set).',
    };
  }

  const source = await loadSourceProduct(service, sourceProductId);
  if (!source) {
    return { ...base, alternative: null, reason: 'source-not-found', note: 'Product not found.' };
  }

  const sourcePrice = await lowestPrice(service, source.id);
  if (sourcePrice !== null && sourcePrice <= budgetUsd) {
    return {
      ...base,
      sourceLowestPriceUsd: sourcePrice,
      alternative: null,
      reason: 'within-budget',
      note: 'This product is already within your budget — no alternative needed.',
    };
  }

  const embedded = await embedText(
    productEmbeddingText({ name: source.name, brand: source.brand, description: source.description })
  );
  if (!embedded.ok) {
    logger.warn('alternative-recommender: embedding failed', { error: embedded.error });
    return { ...base, sourceLowestPriceUsd: sourcePrice, alternative: null, reason: 'error', note: embedded.error };
  }

  const { data: rpcData, error: rpcError } = await service.rpc('match_products', {
    query_embedding: embedded.value,
    match_count: BUDGET_ALTERNATIVE_MATCH_COUNT,
  });
  if (rpcError) {
    if (isMissingTableError(rpcError)) {
      return {
        ...base,
        sourceLowestPriceUsd: sourcePrice,
        alternative: null,
        reason: 'embeddings-empty',
        note: 'Product embeddings are not set up yet. An admin needs to run the backfill once (see docs/visual-search.md).',
      };
    }
    logger.error('alternative-recommender: match_products failed', { error: rpcError.message });
    return { ...base, sourceLowestPriceUsd: sourcePrice, alternative: null, reason: 'error', note: 'Alternative search failed.' };
  }

  const matches = (Array.isArray(rpcData) ? rpcData : []) as RpcMatch[];
  const others = matches.filter((m) => m.product_id !== sourceProductId);
  if (others.length === 0) {
    return {
      ...base,
      sourceLowestPriceUsd: sourcePrice,
      alternative: null,
      reason: 'embeddings-empty',
      note: 'No product embeddings yet — an admin needs to run the backfill once (see docs/visual-search.md).',
    };
  }

  const ids = others.map((m) => m.product_id);
  const { data: products, error: productsError } = await service
    .from('products')
    .select('id, slug, name, brand')
    .in('id', ids)
    .is('deleted_at', null);
  if (productsError) {
    logger.error('alternative-recommender: product lookup failed', { error: productsError.message });
    return { ...base, sourceLowestPriceUsd: sourcePrice, alternative: null, reason: 'error', note: 'Alternative search failed.' };
  }
  const byId = new Map(
    ((products ?? []) as Array<{ id: string; slug: string; name: string; brand: string | null }>).map((p) => [
      p.id,
      p,
    ])
  );

  const candidates: BudgetAlternativeCandidate[] = [];
  for (const match of others) {
    const product = byId.get(match.product_id);
    if (!product) continue; // embedding for a deleted product: skip, never invent
    candidates.push({
      id: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      similarity: match.similarity,
      lowestPriceUsd: await lowestPrice(service, product.id),
    });
  }
  if (candidates.length === 0) {
    return {
      ...base,
      sourceLowestPriceUsd: sourcePrice,
      alternative: null,
      reason: 'embeddings-empty',
      note: 'No product embeddings yet — an admin needs to run the backfill once (see docs/visual-search.md).',
    };
  }

  const alternative = selectBudgetAlternative(candidates, budgetUsd);
  return {
    ...base,
    sourceLowestPriceUsd: sourcePrice,
    alternative,
    reason: alternative ? 'ok' : 'none-within-budget',
    note: alternative
      ? null
      : 'No 95%+ vector match was found within your budget.',
  };
}
