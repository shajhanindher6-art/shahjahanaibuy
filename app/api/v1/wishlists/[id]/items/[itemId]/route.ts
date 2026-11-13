/**
 * API v1 wishlist item delete endpoint.
 * DELETE /api/v1/wishlists/[id]/items/[itemId] — remove an item (auth required).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { removeWishlistItem } from '@/services/wishlists';

import { logApiError } from '@/lib/api/error-logging';
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  logApiRequest(request, {
    endpoint: 'wishlists.items.delete',
    id: params.id,
    itemId: params.itemId,
  });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`wishlists.id.items.itemId:${getClientIp(request)}`, 30);
  if (limited) return limited;


  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const deleted = await removeWishlistItem(supabase, params.itemId, auth.userId);

    if (!deleted) {
      return notFound('Wishlist item not found or not owned by user');
    }

    return apiSuccess({ id: params.itemId, deleted: true });
  } catch (err) {
    logApiError(err, { request, route: 'wishlists.items', status: 500 });
    return internalError('Failed to remove wishlist item');
  }
}
