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
 *
 * GEO ROTATION (homepage fatigue fix): the ranked list is cyclically
 * rotated by (visitor region, UTC day) — see
 * services/deal-rotation.ts. The ranking is preserved; only the
 * leading deal changes per region/day. Region resolves from the
 * Vercel geo header first, then the saved sb-country cookie, then
 * US (same precedence as the affiliate engine's resolver).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, rateLimited } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
// Section 19, Phase 1 (§12 #13) — per-user daily AI quota.
import { checkAiUserQuotaAsync } from '@/services/ai-engine/usage';
import { getSmartDealRecommendations } from '@/services/smart-deals';
import { rotateDealsForRegion } from '@/services/deal-rotation';
import { resolveGeoCountry } from '@/services/affiliate-geo';

// Section 19, Phase 1 (§12 #10) — expensive inline AI work runs under
// maxDuration 60 (matching the 5 cron routes), not the platform default.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'smart-deals' });
  const startedAt = Date.now();
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`smart-deals:${getClientIp(request)}`, 120);
  if (limited) return limited;

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

    // Section 19, Phase 1 (§12 #13) — per-user AI quota when
    // signed in (300 calls/day across AI routes, in-memory).
    // Guests keep the per-IP limit above as their floor.
    if (userId) {
      const quota = await checkAiUserQuotaAsync(userId);
      if (!quota.allowed) {
        return rateLimited('Daily AI usage limit reached. Try again tomorrow.', {
          resetAt: quota.resetAt,
        });
      }
    }

    const result = await getSmartDealRecommendations(supabase, userId, limit);

    // Rotate AFTER the (cached) ranking: the ranking cache stays
    // valid while the leading deal still varies per region/day.
    const region = resolveGeoCountry(
      request.headers.get('x-vercel-ip-country'),
      request.cookies.get('sb-country')?.value ?? null
    );
    const utcDay = new Date().toISOString().slice(0, 10);
    const deals = rotateDealsForRegion(result.deals, region, utcDay);

    return apiSuccess(deals, 200, { basedOn: result.basedOn, region });
  } catch (err) {
    logApiError(err, { request, route: 'smart-deals', status: 500, startedAt });
    return internalError('Failed to fetch smart deals');
  }
}
