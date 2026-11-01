/**
 * Smart deal recommendations endpoint (public, personalized when signed in).
 * GET /api/v1/smart-deals?limit=6 — best discounted products, ranked by
 * AI deal score + discount + trending views, boosted by the signed-in
 * user's activity when available.
 *
 * Unlike /api/v1/recommendations (auth required, no discount signal)
 * and /api/v1/deals/ranked (no user activity, no trending signal),
 * this route is safe to call for guests: without a session it simply
 * returns the trending ranking. Authentication is therefore optional
 * here — a missing session is not an error, it is the guest path.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getSmartDealRecommendations } from '@/services/smart-deals';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'smart-deals' });

  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(12, Math.max(1, Number(searchParams.get('limit') ?? 6)));

    const supabase = await createSupabaseServerClient();
    let userId: string | null = null;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      userId = null;
    }

    const result = await getSmartDealRecommendations(supabase, userId, limit);

    return apiSuccess(result.deals, 200, { basedOn: result.basedOn });
  } catch {
    return internalError('Failed to fetch smart deals');
  }
}
