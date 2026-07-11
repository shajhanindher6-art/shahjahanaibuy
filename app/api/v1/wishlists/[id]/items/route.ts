/**
 * API v1 wishlist items endpoint.
 * GET  /api/v1/wishlists/[id]/items — list items in a wishlist (auth required).
 * POST /api/v1/wishlists/[id]/items — add an item to a wishlist (auth required).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  notFound,
  internalError,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import {
  getWishlistItems,
  addWishlistItem,
  type AddWishlistItemInput,
} from '@/services/wishlists';
import { getCachedProductBySlug } from '@/services/products';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'wishlists.items', id: params.id });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const items = await getWishlistItems(supabase, params.id, auth.userId);

    return apiSuccess(items);
  } catch {
    return internalError('Failed to fetch wishlist items');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'wishlists.items.add', id: params.id });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { productSlug, productId, notes, targetPrice } = body ?? {};

    // Accept either a product slug or a product ID.
    const supabase = await createSupabaseServerClient();
    let resolvedProductId: string | undefined =
      typeof productId === 'string' ? productId : undefined;

    if (!resolvedProductId && typeof productSlug === 'string') {
      const product = await getCachedProductBySlug(supabase, productSlug);
      resolvedProductId = product?.id;
    }

    if (!resolvedProductId) {
      return badRequest('productId or productSlug is required');
    }

    const input: AddWishlistItemInput = {
      notes: typeof notes === 'string' ? notes : undefined,
      targetPrice: typeof targetPrice === 'number' ? targetPrice : undefined,
    };

    const item = await addWishlistItem(
      supabase,
      params.id,
      auth.userId,
      resolvedProductId,
      input
    );

    if (!item) {
      return notFound('Wishlist not found or not owned by user');
    }

    return apiSuccess(item, 201);
  } catch {
    return internalError('Failed to add wishlist item');
  }
}
