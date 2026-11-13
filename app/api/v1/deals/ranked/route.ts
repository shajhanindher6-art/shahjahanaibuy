/**
 * API v1 AI-ranked deals endpoint.
 * GET /api/v1/deals/ranked — deals ranked by AI score, optionally filtered.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { getCachedRankedDeals } from '@/services/ai-deals';

// Section 19, Phase 1 (§12 #10) — expensive inline AI work runs under
// maxDuration 60 (matching the 5 cron routes), not the platform default.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'deals.ranked' });
  const startedAt = Date.now();
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`deals.ranked:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const dealType = searchParams.get('dealType') ?? undefined;
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') ?? 20)));
    const featuredOnly = searchParams.get('featured') === 'true';

    const supabase = await createSupabaseServerClient();
    const result = await getCachedRankedDeals(supabase, { dealType, limit, featuredOnly });

    return apiSuccess(result, 200, {
      categories: result.categories,
    });
  } catch (err) {
    logApiError(err, { request, route: 'deals.ranked', status: 500, startedAt });
    return internalError('Failed to fetch ranked deals');
  }
}
