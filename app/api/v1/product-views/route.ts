/**
 * API v1 product views endpoint.
 * POST   /api/v1/product-views — record that the authenticated user viewed a product.
 * GET    /api/v1/product-views — list the authenticated user's recently viewed
 *        products, most recent first (Section 16, #38 — the homepage strip's
 *        signed-in source; the localStorage strip is the guest path).
 * DELETE /api/v1/product-views — clear the authenticated user's view history
 *        (all rows, or one product with ?productId=<id>).
 *
 * All three are auth-required and own-only (RLS auth.uid() = user_id
 * on product_views, migration 008; every query below is additionally
 * scoped with .eq('user_id', auth.userId)). GET returns the
 * RecentlyViewedItem shape the strip already renders — product
 * name/slug/brand/category/image + lowest in-stock merchant price
 * (null when unknown, never guessed) + viewedAt.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getLowestMerchantPrices } from '@/services/products';
import type { RecentlyViewedItem } from '@/lib/recently-viewed';

import { logApiError } from '@/lib/api/error-logging';
import { validateBody, productViewSchema } from '@/lib/api/validation';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'product-views.list' });
  const limited = await rateLimitResponse(`product-views:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: viewRows, error: viewsError } = await supabase
      .from('product_views')
      .select('product_id, viewed_at')
      .eq('user_id', auth.userId)
      .order('viewed_at', { ascending: false })
      .limit(100);
    if (viewsError || !viewRows) {
      return internalError('Failed to fetch recently viewed products');
    }

    // Dedupe by product (keep the latest view per product), cap 20.
    const latestByProduct = new Map<string, string>();
    for (const row of viewRows as Array<{ product_id: string; viewed_at: string }>) {
      if (!latestByProduct.has(row.product_id)) {
        latestByProduct.set(row.product_id, row.viewed_at);
      }
    }
    const productIds = [...latestByProduct.keys()].slice(0, 20);
    if (productIds.length === 0) return apiSuccess([], 200);

    const { data: productRows, error: productsError } = await supabase
      .from('products')
      .select('id, name, slug, brand, category, image_url')
      .in('id', productIds)
      .is('deleted_at', null)
      .neq('slug', 'sample-laptop');
    if (productsError || !productRows) {
      return internalError('Failed to fetch recently viewed products');
    }
    const prices = await getLowestMerchantPrices(supabase, productIds);
    const byId = new Map(
      (productRows as Array<Record<string, unknown>>).map((r) => [String(r.id), r])
    );
    const items: RecentlyViewedItem[] = [];
    for (const productId of productIds) {
      const row = byId.get(productId);
      if (!row) continue;
      items.push({
        id: productId,
        slug: String(row.slug),
        name: String(row.name),
        brand: (row.brand as string | null) ?? null,
        category: (row.category as string | null) ?? null,
        imageUrl: (row.image_url as string | null) ?? null,
        price: prices.get(productId)?.price ?? null,
        viewedAt: latestByProduct.get(productId) ?? new Date().toISOString(),
      });
    }
    return apiSuccess(items, 200);
  } catch (err) {
    logApiError(err, { request, route: 'product-views.get', status: 500 });
    return internalError('Failed to fetch recently viewed products');
  }
}

export async function DELETE(request: NextRequest) {
  logApiRequest(request, { endpoint: 'product-views.delete' });
  const limited = await rateLimitResponse(`product-views:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const productId = request.nextUrl.searchParams.get('productId');
    let query = supabase.from('product_views').delete().eq('user_id', auth.userId);
    if (productId) query = query.eq('product_id', productId);
    const { error } = await query;
    if (error) {
      return internalError('Failed to clear recently viewed products');
    }
    return apiSuccess({ cleared: true, productId: productId ?? null });
  } catch (err) {
    logApiError(err, { request, route: 'product-views.delete', status: 500 });
    return internalError('Failed to clear recently viewed products');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'product-views' });
  // Rate limit: 60 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`product-views:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    // Final 100%, F-P1-60 — schema validation (was hand-rolled).
    const validation = validateBody(productViewSchema, body ?? {});
    // Narrowing check (not invalidBodyResponse — it does not narrow
    // the union, so validation.data would not type-check). Same 400
    // as invalidBodyResponse: the first error, same message.
    if (!validation.success) {
      const firstError = Object.values(validation.errors).flat()[0];
      return badRequest(firstError ?? 'Invalid request body');
    }
    const { productId } = validation.data;

    if (typeof productId !== 'string' || productId.trim() === '') {
      return badRequest('productId is required');
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from('product_views').insert({
      user_id: auth.userId,
      product_id: productId,
    });

    if (error) {
      return internalError('Failed to record product view');
    }

    return apiSuccess({ recorded: true }, 201);
  } catch (err) {
    logApiError(err, { request, route: 'product-views.post', status: 500 });
    return internalError('Failed to record product view');
  }
}
