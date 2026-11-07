/**
 * API v1 visual-search endpoint (Delta 1: vector upgrade).
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
 * Honest states (never a faked match or score):
 * - No HF_API_TOKEN configured → 503, feature not configured.
 * - Embeddings table missing → 503, admin must run the SQL + backfill.
 * - No embeddings stored yet → 200 with [] + an honest note.
 * - Captioning/embedding fails → 503 (retryable) or 400 (bad input).
 * Uploaded photos are NEVER accepted here: only a public URL or
 * plain caption text. Nothing is stored.
 */

import type { NextRequest } from 'next/server';
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
import {
  captionPublicImageUrl,
  embedText,
  isPublicImageUrl,
  isVectorSearchConfigured,
} from '@/services/visual-search';

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

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'visual-search' });

  // Each call spends Hugging Face quota, so the tightest cap here:
  // 10/min per IP. Redis-backed when Upstash is configured.
  const limited = await rateLimitResponse(`visual-search:${getClientIp(request)}`, 10);
  if (limited) return limited;

  if (!isVectorSearchConfigured()) {
    return serviceUnavailable(
      'Visual vector search is not configured on this site yet. An admin needs to set HF_API_TOKEN (see docs/visual-search.md).'
    );
  }

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

  // Resolve the text to embed: caption the public image, or use the
  // caller-supplied caption as-is. The photo itself is never stored.
  let caption = captionInput;
  if (imageUrl) {
    const captioned = await captionPublicImageUrl(imageUrl);
    if (!captioned.ok) {
      return captioned.retryable
        ? serviceUnavailable(captioned.error)
        : badRequest(captioned.error);
    }
    caption = captioned.value;
  }

  const embedded = await embedText(caption);
  if (!embedded.ok) {
    return embedded.retryable
      ? serviceUnavailable(embedded.error)
      : badRequest(embedded.error);
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return serviceUnavailable(
      'Visual search is not fully configured on this site yet (database service client unavailable).'
    );
  }

  const { data: rpcData, error: rpcError } = await service.rpc('match_products', {
    query_embedding: embedded.value,
    match_count: limit,
  });
  if (rpcError) {
    if (isMissingTableError(rpcError)) {
      return serviceUnavailable(
        'Product embeddings are not set up yet. An admin needs to run supabase/add-visual-embeddings.sql and the backfill once (see docs/visual-search.md).'
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
      note: 'No matches yet — the catalog has no product embeddings. An admin needs to run the backfill once (see docs/visual-search.md).',
    });
  }

  const ids = matches.map((m) => m.product_id);
  const { data: products, error: productsError } = await service
    .from('products')
    .select('id, slug, name, brand')
    .in('id', ids)
    .is('deleted_at', null);
  if (productsError) {
    logger.error('visual-search: product lookup failed', { error: productsError.message });
    return internalError('Visual search failed');
  }

  const byId = new Map(
    ((products ?? []) as Array<{ id: string; slug: string; name: string; brand: string | null }>).map(
      (p) => [p.id, p]
    )
  );

  // Lowest recorded price per match, reusing the existing catalog
  // helper (merchant listings ordered by price ascending). A failure
  // to load prices degrades to null — never an invented price.
  const results = [];
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

  return apiSuccess(results, 200, {
    mode: 'vector',
    caption,
    note: 'Vector match — similarity is cosine similarity against the catalog embeddings (1 = closest). Prices are the lowest recorded merchant price, when one exists.',
  });
}
