/**
 * API v1 search history endpoint.
 * GET /api/v1/search-history — list the authenticated user's search history.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getSearchHistory } from '@/services/ai-search';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'search-history' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`search-history:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 20)));

    const supabase = await createSupabaseServerClient();
    const history = await getSearchHistory(supabase, auth.userId, limit);

    return apiSuccess(history, 200);
  } catch {
    return internalError('Failed to fetch search history');
  }
}
