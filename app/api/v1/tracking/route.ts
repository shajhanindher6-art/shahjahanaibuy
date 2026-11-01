/**
 * User tracking dashboard endpoint.
 * GET /api/v1/tracking — the authenticated user's saved products
 * (wishlist items with current/previous price and target status) plus
 * their price alerts, in one call, for /dashboard/tracking.
 *
 * Auth required and owner-scoped: the tracking service runs with the
 * authenticated server client, so RLS only exposes this user's own
 * wishlists and alerts. Product and price_history rows are public
 * catalog data (see the public-catalog RLS fix).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { getUserTracking } from '@/services/tracking';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tracking' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const tracking = await getUserTracking(supabase, auth.userId);

    return apiSuccess(tracking);
  } catch {
    return internalError('Failed to fetch tracking dashboard');
  }
}
