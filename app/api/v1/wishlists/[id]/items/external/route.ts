/**
 * API v1 external wishlist items (Option 8, Feature 5).
 * GET  /api/v1/wishlists/[id]/items/external — external items in a
 *        wishlist (auth required, owner only).
 * POST /api/v1/wishlists/[id]/items/external — add an item from ANY store
 *        by pasting its URL (auth required, owner only).
 *
 * HONESTY: external items NEVER claim price tracking — they render as
 * "External item — price tracking unavailable" unless the user explicitly
 * links a catalog product by slug (validated here against the products
 * table). A catalog match is never applied automatically. If
 * supabase/add-external-wishlist-items.sql has not been run yet, GET
 * returns { items: [], externalEnabled: false } and POST returns 503.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
  notFound,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { getCachedProductBySlug } from '@/services/products';
import { storeDomainFromUrl } from '@/services/external-wishlist';

function isMissingColumnOrTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === '42703';
}

async function verifyOwnership(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  wishlistId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('wishlists')
    .select('user_id')
    .eq('id', wishlistId)
    .maybeSingle();
  if (error || !data) return false;
  return (data as { user_id: string }).user_id === userId;
}

const SELECT =
  'id, wishlist_id, product_id, notes, target_price, sort_order, added_at, external_title, external_store, external_url, external_price, external_currency';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'wishlists.items.external', id: params.id });
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    if (!(await verifyOwnership(supabase, params.id, auth.userId))) {
      return notFound('Wishlist not found or not owned by user');
    }
    const { data, error } = await supabase
      .from('wishlist_items')
      .select(SELECT)
      .eq('wishlist_id', params.id)
      .not('external_url', 'is', null)
      .order('added_at', { ascending: false });
    if (error) {
      if (isMissingColumnOrTable(error)) return apiSuccess([], 200, { externalEnabled: false });
      return internalError('Failed to fetch external items');
    }
    return apiSuccess(data ?? [], 200, { externalEnabled: true });
  } catch {
    return internalError('Failed to fetch external items');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'wishlists.items.external.add', id: params.id });
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!title) return badRequest('title is required');
    const store = storeDomainFromUrl(url);
    if (!store) return badRequest('a valid http(s) product URL is required');
    const price =
      body?.price === null || body?.price === undefined || body?.price === ''
        ? null
        : Number(body.price);
    if (price !== null && !Number.isFinite(price)) return badRequest('price must be a number');

    const supabase = await createSupabaseServerClient();
    if (!(await verifyOwnership(supabase, params.id, auth.userId))) {
      return notFound('Wishlist not found or not owned by user');
    }

    // Optional catalog link — ONLY when the user explicitly supplies a slug
    // that resolves to a real product. Never matched automatically.
    let productId: string | null = null;
    if (typeof body?.catalogSlug === 'string' && body.catalogSlug.trim()) {
      const product = await getCachedProductBySlug(supabase, body.catalogSlug.trim());
      if (product) productId = product.id;
    }

    const { data, error } = await supabase
      .from('wishlist_items')
      .insert({
        wishlist_id: params.id,
        product_id: productId,
        notes: typeof body?.notes === 'string' ? body.notes : null,
        external_title: title,
        external_store: store,
        external_url: url,
        external_price: price,
        external_currency:
          typeof body?.currency === 'string' && body.currency.trim()
            ? body.currency.trim().toUpperCase()
            : null,
      })
      .select(SELECT)
      .single();
    if (error || !data) {
      if (isMissingColumnOrTable(error)) {
        return serviceUnavailable(
          'External wishlist items are not live yet — the owner still needs to run supabase/add-external-wishlist-items.sql.'
        );
      }
      return internalError('Failed to add external item');
    }
    return apiSuccess(data, 201);
  } catch {
    return internalError('Failed to add external item');
  }
}
