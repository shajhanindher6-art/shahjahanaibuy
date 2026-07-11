/**
 * API v1 wishlists endpoint.
 * GET  /api/v1/wishlists — list the authenticated user's wishlists.
 * POST /api/v1/wishlists — create a wishlist (auth required).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import {
  getWishlists,
  createWishlist,
  type CreateWishlistInput,
} from '@/services/wishlists';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'wishlists' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const wishlists = await getWishlists(supabase, auth.userId);

    return apiSuccess(wishlists);
  } catch {
    return internalError('Failed to fetch wishlists');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'wishlists.create' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { name, description, isPublic } = body ?? {};

    if (typeof name !== 'string' || name.trim() === '') {
      return badRequest('name is required');
    }

    const input: CreateWishlistInput = {
      name,
      description: typeof description === 'string' ? description : undefined,
      isPublic: typeof isPublic === 'boolean' ? isPublic : false,
    };

    const supabase = await createSupabaseServerClient();
    const wishlist = await createWishlist(supabase, auth.userId, input);

    if (!wishlist) {
      return internalError('Failed to create wishlist');
    }

    return apiSuccess(wishlist, 201);
  } catch {
    return internalError('Failed to create wishlist');
  }
}
