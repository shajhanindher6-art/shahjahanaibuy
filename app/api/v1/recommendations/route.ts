/**
 * API v1 recommendations endpoint.
 * GET /api/v1/recommendations — personalized recommendations for the authenticated user.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { getRecommendations } from '@/services/ai-recommendations';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'recommendations' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') ?? 10)));

    const supabase = await createSupabaseServerClient();
    const { recommendations, context } = await getRecommendations(supabase, auth.userId, limit);

    return apiSuccess(recommendations, 200, {
      basedOn: context.basedOn,
    });
  } catch {
    return internalError('Failed to fetch recommendations');
  }
}
