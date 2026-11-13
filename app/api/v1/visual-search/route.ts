/**
 * API v1 visual-search endpoint (Delta 1: vector upgrade + CLIP space).
 * POST /api/v1/visual-search — match a photo against the catalog
 * by vector similarity, not by keywords.
 *
 * Body: { imageUrl?: string, caption?: string, limit?: number }
 * - imageUrl: a PUBLIC image URL. Its bytes are fetched server-side
 *   and captioned with BLIP; the caption is embedded and matched.
 * - caption: plain text describing the product (e.g. typed by the
 *   user after looking at their photo). Embedded directly.
 * - limit: max matches, 1..10, default 5.
 *
 * TWO embedding spaces (never mixed):
 * - CLIP (512 dims, product_clip_embeddings): consulted FIRST when
 *   the table has rows. The caption is embedded with CLIP's text
 *   encoder via the Hugging Face Inference API; the stored vectors
 *   were generated OFFLINE by scripts/embed-products-local.mjs.
 * - MiniLM (384 dims, product_embeddings): the default/fallback.
 *   Used when the CLIP table is empty/missing or the CLIP embedding
 *   fails. `meta.mode` says which path served the request
 *   ('vector-clip' vs 'vector').
 *
 * Honest states (never a faked match or score):
 * - No HF_API_TOKEN configured → 503, feature not configured.
 * - Both embeddings tables missing → 503, admin must run the SQL +
 *   backfill (MiniLM path reports this; CLIP-only absence just
 *   falls back to MiniLM).
 * - No embeddings stored yet → 200 with [] + an honest note.
 * - Captioning/embedding fails → 503 (retryable) or 400 (bad input).
 * Uploaded photos are NEVER accepted here: only a public URL or
 * plain caption text. Nothing is stored.
 */

import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getMerchantProducts } from '@/services/commerce';
import { logger } from '@/lib/config/logger';
import {
  apiSuccess,
  badRequest,
  internalError,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import {
  isPublicImageUrl,
  isVectorSearchConfigured,
  type HfResult,
} from '@/services/visual-search';
// Section 19, Phase 1 (§12 #1, #4, #8, #9) — caption + embedding
// run through the AI engine (HF CLIP → MiniLM fallback chain,
// usage/latency tracking, durable provider-health reporting).
import { getAiEngine, type AIEngineResult } from '@/services/ai-engine';
import { reportAiProviderHealth } from '@/services/ai-engine/health-report';
// Section 19, Phase 1 (§12 #7) — tightened anon cap (10 → 5/min).
import { VISUAL_SEARCH_ANON_PER_MIN } from '@/services/ai-engine/usage';

// Section 19, Phase 1 (§12 #10) — expensive inline AI work runs under
// maxDuration 60 (matching the 5 cron routes), not the platform default.
export const maxDuration = 60;

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

interface RpcMatch {
  product_id: string;
  similarity: number;
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205';
}

interface EnrichedVisualMatch {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  similarity: number;
  lowestPriceUsd: number | null;
}

/**
 * Shared by both embedding paths: turn RPC matches into enriched
 * results (product details + lowest recorded price). A product
 * lookup failure returns { ok: false } so the caller can answer
 * 500; a deleted product's embedding is skipped, never invented.
 */
async function enrichMatches(
  service: SupabaseClient,
  matches: RpcMatch[]
): Promise<{ ok: true; results: EnrichedVisualMatch[] } | { ok: false }> {
  const ids = matches.map((m) => m.product_id);
  const { data: products, error: productsError } = await service
    .from('products')
    .select('id, slug, name, brand')
    .in('id', ids)
    .neq('slug', 'sample-laptop')
    .is('deleted_at', null);
  if (productsError) {
    logger.error('visual-search: product lookup failed', { error: productsError.message });
    return { ok: false };
  }

  const byId = new Map(
    ((products ?? []) as Array<{ id: string; slug: string; name: string; brand: string | null }>).map(
      (p) => [p.id, p]
    )
  );

  // Lowest recorded price per match, reusing the existing catalog
  // helper (merchant listings ordered by price ascending). A failure
  // to load prices degrades to null — never an invented price.
  const results: EnrichedVisualMatch[] = [];
  for (const match of matches) {
    const product = byId.get(match.product_id);
    if (!product) continue; // embedding for a deleted product: skip, never invent
    let lowestPriceUsd: number | null = null;
    try {
      const listings = await getMerchantProducts(service, product.id);
      if (listings.length > 0 && Number.isFinite(listings[0].price)) {
        lowestPriceUsd = listings[0].price;
      }
    } catch {
      lowestPriceUsd = null;
    }
    results.push({
      id: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      similarity: Math.round(match.similarity * 1000) / 1000,
      lowestPriceUsd,
    });
  }
  return { ok: true, results };
}

/**
 * Run one embedding-space RPC (`match_clip_products` or
 * `match_products`) and normalise the result. A missing-table
 * error is reported as a failure the caller can recognise (the
 * table simply is not set up yet), never thrown.
 */
async function matchEmbeddingRpc(
  service: SupabaseClient,
  rpcName: string,
  vector: number[],
  limit: number
): Promise<
  | { ok: true; matches: RpcMatch[] }
  | { ok: false; error: { code?: string; message?: string } | null }
> {
  const { data, error } = await service.rpc(rpcName, {
    query_embedding: vector,
    match_count: limit,
  });
  if (error) return { ok: false, error };
  return { ok: true, matches: (Array.isArray(data) ? data : []) as RpcMatch[] };
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'visual-search' });
  const startedAt = Date.now();

  // Each call spends Hugging Face quota, so the tightest cap here:
  // 5/min per IP (Section 19, Phase 1, §12 #7 — tightened from
  // 10/min). Redis-backed when Upstash is configured.
  const limited = await rateLimitResponse(
    `visual-search:${getClientIp(request)}`,
    VISUAL_SEARCH_ANON_PER_MIN
  );
  if (limited) return limited;

  if (!isVectorSearchConfigured()) {
    return serviceUnavailable(
      'Visual vector search is not configured on this site yet. An admin needs to set HF_API_TOKEN (see docs/visual-search.md).'
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
    const captionInput = typeof body?.caption === 'string' ? body.caption.trim() : '';
    const rawLimit = typeof body?.limit === 'number' ? body.limit : DEFAULT_LIMIT;
    const limit = Math.min(Math.max(Math.floor(rawLimit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    if (!imageUrl && !captionInput) {
      return badRequest(
        'Provide a public image URL (imageUrl) or a text description (caption) to match against the catalog.'
      );
    }
    if (imageUrl && !isPublicImageUrl(imageUrl)) {
      return badRequest('imageUrl must be a public http(s) URL.');
    }

    const service = createSupabaseServiceClient();
    if (!service) {
      return serviceUnavailable(
        'Visual search is not fully configured on this site yet (database service client unavailable).'
      );
    }

    // Section 19, Phase 1 (§12 #8) — durable HF provider health.
    // The HF service itself has no Supabase client in scope, so
    // the route reports each engine-routed HF call here from the
    // engine result (backend key + latency). Best-effort: a
    // missing table / RLS denial never fails the search.
    const reportHf = (success: boolean, latencyMs: number, error?: string) =>
      reportAiProviderHealth(service, 'huggingface', {
        success,
        responseMs: latencyMs,
        ...(error ? { error: error.slice(0, 200) } : {}),
      });

    // Resolve the text to embed: caption the public image, or use the
    // caller-supplied caption as-is. The photo itself is never stored.
    let caption = captionInput;
    if (imageUrl) {
      // Section 19, Phase 1 (§12 #1) — captioning via the engine's
      // HF caption provider. The value IS the HfResult: the route
      // decides 503 vs 400 from its `retryable` flag, exactly as
      // the old direct call did.
      let captioned: AIEngineResult<HfResult<string>>;
      try {
        captioned = await getAiEngine().invoke<HfResult<string>>('visual-caption', { imageUrl });
      } catch (err) {
        return serviceUnavailable(
          err instanceof Error
            ? err.message
            : 'Visual search service failed. Please try again later.'
        );
      }
      void reportHf(
        captioned.value.ok,
        captioned.latencyMs,
        captioned.value.ok ? undefined : captioned.value.error
      );
      if (!captioned.value.ok) {
        return captioned.value.retryable
          ? serviceUnavailable(captioned.value.error)
          : badRequest(captioned.value.error);
      }
      caption = captioned.value.value;
    }

    // CLIP table check (was inside tryClipPath): does the CLIP
    // table have rows? A missing table / zero rows is normal
    // (dormant until the owner runs the SQL + local script) — the
    // MiniLM path serves instead, never an error.
    const { count: clipCount, error: clipCountError } = await service
      .from('product_clip_embeddings')
      .select('product_id', { count: 'exact', head: true });
    if (clipCountError && !isMissingTableError(clipCountError)) {
      logger.warn('visual-search: CLIP table check failed', { error: clipCountError.message });
    }
    const preferClip = !clipCountError && !!clipCount && clipCount > 0;

    // Section 19, Phase 1 (§12 #4) — embedding via the engine:
    // CLIP first, MiniLM fallback; `fallbackUsed` says which
    // served and is disclosed in meta. An engine throw means BOTH
    // providers failed; the last error carries the `retryable`
    // flag, exactly as the old direct calls did (503 retryable vs
    // 400 bad input).
    const embedFailureResponse = (err: unknown): Response => {
      const retryable = (err as { retryable?: unknown })?.retryable === true;
      const message =
        err instanceof Error ? err.message : 'Visual search service failed. Please try again later.';
      return retryable ? serviceUnavailable(message) : badRequest(message);
    };
    const invokeEmbed = async (prefer: boolean): Promise<AIEngineResult<number[]>> => {
      const invokeStart = Date.now();
      try {
        const res = await getAiEngine().invoke<number[]>('visual-embed', {
          text: caption,
          preferClip: prefer,
        });
        void reportHf(true, Date.now() - invokeStart);
        return res;
      } catch (err) {
        void reportHf(
          false,
          Date.now() - invokeStart,
          err instanceof Error ? err.message : 'embedding failed'
        );
        throw err;
      }
    };

    let embedded: AIEngineResult<number[]>;
    try {
      embedded = await invokeEmbed(preferClip);
    } catch (err) {
      return embedFailureResponse(err);
    }
    let fallbackUsed = embedded.fallbackUsed;

    // CLIP path first, when the CLIP table has rows. Any CLIP-side
    // failure (RPC error, zero matches) falls through to MiniLM
    // below — never an error.
    if (embedded.providerKey === 'huggingface-clip') {
      const clipRes = await matchEmbeddingRpc(
        service,
        'match_clip_products',
        embedded.value,
        limit
      );
      if (clipRes.ok && clipRes.matches.length > 0) {
        const enriched = await enrichMatches(service, clipRes.matches);
        if (!enriched.ok) return internalError('Visual search failed');
        return apiSuccess(enriched.results, 200, {
          mode: 'vector-clip',
          caption,
          fallbackUsed,
          note: 'CLIP vector match — the caption was embedded with CLIP (512-dim text encoder) and matched against the locally generated CLIP embeddings (1 = closest). Prices are the lowest recorded merchant price, when one exists.',
        });
      }
      if (!clipRes.ok && !isMissingTableError(clipRes.error)) {
        logger.warn('visual-search: match_clip_products failed, falling back to MiniLM', {
          error: clipRes.error?.message,
        });
      }
      // Fall through to MiniLM: re-embed without CLIP.
      try {
        embedded = await invokeEmbed(false);
      } catch (err) {
        return embedFailureResponse(err);
      }
      fallbackUsed = true;
    }

    const { data: rpcData, error: rpcError } = await service.rpc('match_products', {
      query_embedding: embedded.value,
      match_count: limit,
    });
    if (rpcError) {
      if (isMissingTableError(rpcError)) {
        return serviceUnavailable(
          'Product embeddings are not set up yet. An admin needs to run supabase/add-visual-embeddings.sql (and, for the CLIP path, supabase/add-clip-embeddings.sql + scripts/embed-products-local.mjs) and the backfill once (see docs/visual-search.md).'
        );
      }
      logger.error('visual-search: match_products failed', { error: rpcError.message });
      return internalError('Visual search failed');
    }

    const matches = (Array.isArray(rpcData) ? rpcData : []) as RpcMatch[];
    if (matches.length === 0) {
      return apiSuccess([], 200, {
        mode: 'vector',
        caption,
        fallbackUsed,
        note: 'No matches yet — the catalog has no product embeddings. An admin needs to run the backfill once (see docs/visual-search.md).',
      });
    }

    const enriched = await enrichMatches(service, matches);
    if (!enriched.ok) return internalError('Visual search failed');

    return apiSuccess(enriched.results, 200, {
      mode: 'vector',
      caption,
      fallbackUsed,
      note: 'Vector match — similarity is cosine similarity against the catalog embeddings (1 = closest). Prices are the lowest recorded merchant price, when one exists.',
    });
  } catch (err) {
    logApiError(err, { request, route: 'visual-search', status: 500, startedAt });
    return internalError('Visual search failed');
  }
}
