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
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  getWishlists,
  createWishlist,
  type CreateWishlistInput,
} from '@/services/wishlists';
import { getPollCountsByWishlist } from '@/lib/wishlist-polls';

import { logApiError } from '@/lib/api/error-logging';
import { validateBody, wishlistSchema } from '@/lib/api/validation';
export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'wishlists' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`wishlists:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const wishlists = await getWishlists(supabase, auth.userId);

    // Section 13, item 53 — poll counts batched into the list
    // response (one query, no new table): the list page shows a
    // poll-count badge and an "Ask friends to vote" link per list.
    // A missing 033 table yields an empty map — every list simply
    // reports 0 polls, never a failed list fetch.
    const pollCounts = await getPollCountsByWishlist(
      supabase,
      wishlists.map((w) => w.id)
    );

    return apiSuccess(
      wishlists.map((w) => ({ ...w, pollCount: pollCounts.get(w.id) ?? 0 }))
    );
  } catch (err) {
    logApiError(err, { request, route: 'wishlists.get', status: 500 });
    return internalError('Failed to fetch wishlists');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'wishlists.create' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`wishlists:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    // Final 100%, F-P1-60 — schema validation (was hand-rolled).
    // A non-string `description` now 400s instead of being
    // silently dropped; a non-boolean `isPublic` now 400s instead
    // of being silently treated as false.
    const validation = validateBody(wishlistSchema, body ?? {});
    // Narrowing check (not invalidBodyResponse — it does not narrow
    // the union, so validation.data would not type-check). Same 400
    // as invalidBodyResponse: the first error, same message.
    if (!validation.success) {
      const firstError = Object.values(validation.errors).flat()[0];
      return badRequest(firstError ?? 'Invalid request body');
    }
    const { name, description, isPublic } = validation.data;

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
  } catch (err) {
    logApiError(err, { request, route: 'wishlists.post', status: 500 });
    return internalError('Failed to create wishlist');
  }
}
