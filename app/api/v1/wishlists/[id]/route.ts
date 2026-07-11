/**
 * API v1 wishlist detail endpoint.
 * GET    /api/v1/wishlists/[id] — fetch a wishlist (auth required, owner only).
 * PATCH  /api/v1/wishlists/[id] — update a wishlist (auth required, owner only).
 * DELETE /api/v1/wishlists/[id] — delete a wishlist (auth required, owner only).
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
  getWishlists,
  updateWishlist,
  deleteWishlist,
  type UpdateWishlistInput,
} from '@/services/wishlists';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'wishlists.detail', id: params.id });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const wishlists = await getWishlists(supabase, auth.userId);
    const wishlist = wishlists.find((w) => w.id === params.id);

    if (!wishlist) {
      return notFound('Wishlist not found');
    }

    return apiSuccess(wishlist);
  } catch {
    return internalError('Failed to fetch wishlist');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'wishlists.update', id: params.id });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { name, description, isPublic } = body ?? {};

    const input: UpdateWishlistInput = {};
    if (typeof name === 'string') input.name = name;
    if (typeof description === 'string') input.description = description;
    if (typeof isPublic === 'boolean') input.isPublic = isPublic;

    if (Object.keys(input).length === 0) {
      return badRequest('No fields to update');
    }

    const supabase = await createSupabaseServerClient();
    const updated = await updateWishlist(supabase, params.id, auth.userId, input);

    if (!updated) {
      return notFound('Wishlist not found or not owned by user');
    }

    return apiSuccess(updated);
  } catch {
    return internalError('Failed to update wishlist');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'wishlists.delete', id: params.id });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const deleted = await deleteWishlist(supabase, params.id, auth.userId);

    if (!deleted) {
      return notFound('Wishlist not found or not owned by user');
    }

    return apiSuccess({ id: params.id, deleted: true });
  } catch {
    return internalError('Failed to delete wishlist');
  }
}
