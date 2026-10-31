/**
 * Public shared-wishlist endpoint.
 * GET /api/v1/shared-wishlists/[id] — no login required.
 *
 * Returns a wishlist ONLY when it is marked public (is_public=true).
 * Private and missing wishlists both return 404, so the endpoint
 * cannot be used to probe for private lists. The response contains
 * no owner user_id and no private item notes.
 *
 * Requires the anon SELECT policies in
 * supabase/add-public-wishlist-sharing-rls.sql to be applied in
 * Supabase; without them the anon server client sees no rows and
 * every shared link returns 404.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getPublicSharedWishlist } from '@/services/wishlists';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'shared-wishlists', id: params.id });

  try {
    const supabase = await createSupabaseServerClient();
    const shared = await getPublicSharedWishlist(supabase, params.id);

    if (!shared) {
      return notFound('Shared wishlist not found');
    }

    return apiSuccess(shared);
  } catch {
    return internalError('Failed to fetch shared wishlist');
  }
}
