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
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getPublicSharedWishlist } from '@/services/wishlists';
import { appConfig } from '@/lib/config/app';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'shared-wishlists', id: params.id });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`shared-wishlists.id:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const shared = await getPublicSharedWishlist(supabase, params.id);

    if (!shared) {
      return notFound('Shared wishlist not found');
    }

    // S3#11: link the public list to the gift recommender so a
    // visitor viewing someone's wishlist can find a gift from it.
    // (The /wishlists/[id] page renders this link — wave-2 UI task;
    // that page is owned by another worker this batch.)
    return apiSuccess({
      ...shared,
      shareUrl: `${appConfig.url}/wishlists/${shared.id}`,
      giftFinderUrl: '/gifts',
    });
  } catch (err) {
    logApiError(err, { request, route: 'shared-wishlists', status: 500 });
    return internalError('Failed to fetch shared wishlist');
  }
}
