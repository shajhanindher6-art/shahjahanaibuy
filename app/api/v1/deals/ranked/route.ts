/**
 * API v1 AI-ranked deals endpoint.
 * GET /api/v1/deals/ranked — deals ranked by AI score, optionally filtered.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getCachedRankedDeals } from '@/services/ai-deals';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'deals.ranked' });
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
  } catch {
    return internalError('Failed to fetch ranked deals');
  }
}
