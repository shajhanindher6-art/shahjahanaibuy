/**
 * API v1 recommendations endpoint.
 * GET /api/v1/recommendations — personalized recommendations for the authenticated user.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, rateLimited } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
// Section 19, Phase 1 (§12 #13) — per-user daily AI quota.
import { checkAiUserQuotaAsync } from '@/services/ai-engine/usage';
import { getRecommendations } from '@/services/ai-recommendations';

// Section 19, Phase 1 (§12 #10) — expensive inline AI work runs under
// maxDuration 60 (matching the 5 cron routes), not the platform default.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'recommendations' });
  const startedAt = Date.now();
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`recommendations:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  // Section 19, Phase 1 (§12 #13) — per-user AI quota (300
  // calls/day across AI routes, in-memory). The per-IP limit above
  // stays as the floor; this binds one signed-in user, not the IP.
  const quota = await checkAiUserQuotaAsync(auth.userId);
  if (!quota.allowed) {
    return rateLimited('Daily AI usage limit reached. Try again tomorrow.', {
      resetAt: quota.resetAt,
    });
  }

  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') ?? 10)));

    const supabase = await createSupabaseServerClient();
    const { recommendations, context } = await getRecommendations(supabase, auth.userId, limit);

    return apiSuccess(recommendations, 200, {
      basedOn: context.basedOn,
      // Section 19, Phase 4 (§12 #43) — the page labels
      // trending-only results when the user opted out.
      personalizationOptOut: context.personalizationOptOut ?? false,
    });
  } catch (err) {
    logApiError(err, { request, route: 'recommendations', status: 500, startedAt });
    return internalError('Failed to fetch recommendations');
  }
}
