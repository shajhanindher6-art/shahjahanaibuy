/**
 * API v1 admin visual-search backfill endpoint (Delta 1).
 * POST /api/v1/admin/visual-search-backfill — embed the catalog.
 *
 * Admin only (requireAdmin) + 10/min rate limit. Embeds each catalog
 * product's name + brand + description with all-MiniLM-L6-v2 and
 * upserts the 384-dim vector into product_embeddings.
 *
 * Body: { force?: boolean }
 * - force omitted/false: only products WITHOUT an embedding are
 *   embedded (resumable — a run cut short by the free-tier function
 *   timeout can simply be called again to finish the rest).
 * - force true: re-embed every product, replacing stored vectors.
 *
 * Honest states: no HF_API_TOKEN → 503; embeddings table missing →
 * 503 with the exact owner step; per-product failures are reported
 * in the response (failed[]) instead of failing the whole run.
 * Nothing is ever embedded from a user photo — catalog text only.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/config/logger';
import { apiSuccess, internalError, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAdmin, getClientIp } from '@/lib/api/middleware';
import { recordAdminAction } from '@/services/admin';
import {
  embedText,
  isVectorSearchConfigured,
  productEmbeddingText,
} from '@/services/visual-search';

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205';
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin-visual-search-backfill' });

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`visual-search-backfill:${auth.userId}`, 10);
  if (limited) return limited;

  if (!isVectorSearchConfigured()) {
    return serviceUnavailable(
      'Hugging Face API token is not configured. Set HF_API_TOKEN first (see docs/visual-search.md).'
    );
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return serviceUnavailable('Database service client is not configured.');
  }

  const body = await request.json().catch(() => null);
  const force = body?.force === true;

  const { data: products, error: productsError } = await service
    .from('products')
    .select('id, slug, name, brand, description')
    .is('deleted_at', null)
    .order('name', { ascending: true });
  if (productsError) {
    logger.error('visual-search-backfill: product fetch failed', { error: productsError.message });
    return internalError('Could not load the catalog.');
  }
  const catalog = (products ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    brand: string | null;
    description: string | null;
  }>;

  // Which products already have an embedding? Skipped unless force.
  const { data: existing, error: existingError } = await service
    .from('product_embeddings')
    .select('product_id');
  if (existingError) {
    if (isMissingTableError(existingError)) {
      return serviceUnavailable(
        'Product embeddings table is not set up yet. Run supabase/add-visual-embeddings.sql in the Supabase SQL Editor first (see docs/visual-search.md).'
      );
    }
    logger.error('visual-search-backfill: embedding lookup failed', { error: existingError.message });
    return internalError('Could not check existing embeddings.');
  }
  const embeddedIds = new Set(
    ((existing ?? []) as Array<{ product_id: string }>).map((row) => row.product_id)
  );

  const todo = force ? catalog : catalog.filter((p) => !embeddedIds.has(p.id));
  const alreadyEmbedded = catalog.length - todo.length;

  let embedded = 0;
  const failed: Array<{ slug: string; error: string }> = [];

  for (const product of todo) {
    const text = productEmbeddingText({
      name: product.name,
      brand: product.brand,
      description: product.description,
    });
    const result = await embedText(text);
    if (!result.ok) {
      failed.push({ slug: product.slug, error: result.error });
      continue;
    }
    const { error: upsertError } = await service.from('product_embeddings').upsert(
      {
        product_id: product.id,
        embedding: result.value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'product_id' }
    );
    if (upsertError) {
      if (isMissingTableError(upsertError)) {
        return serviceUnavailable(
          'Product embeddings table is not set up yet. Run supabase/add-visual-embeddings.sql in the Supabase SQL Editor first (see docs/visual-search.md).'
        );
      }
      logger.error('visual-search-backfill: upsert failed', {
        slug: product.slug,
        error: upsertError.message,
      });
      failed.push({ slug: product.slug, error: 'Could not store the embedding.' });
      continue;
    }
    embedded++;
  }

  // Section 18, item 14 — audit the backfill run. recordAdminAction
  // never throws: a logging failure is recorded by the logger and
  // never fails the admin action itself.
  await recordAdminAction(
    service,
    auth.userId,
    'visual_search_backfill',
    'product_embeddings',
    null,
    {
      total: catalog.length,
      alreadyEmbedded,
      embedded,
      failed: failed.length,
      failedSlugs: failed.map((f) => f.slug),
      force,
    },
    getClientIp(request)
  );

  return apiSuccess(
    {
      total: catalog.length,
      alreadyEmbedded,
      embedded,
      failed,
    },
    200,
    {
      note:
        failed.length > 0
          ? 'Some products failed to embed — see failed[]. Re-running this route retries only the products still missing an embedding.'
          : 'Catalog embeddings are up to date. Re-run with { force: true } to re-embed everything.',
    }
  );
}
