/**
 * API v1 community deal vote endpoint.
 * POST /api/v1/community-deals/[id]/vote — { value: 1 | -1 | 0 }.
 *
 * Auth required. One vote per user per deal (UNIQUE (deal_id,
 * user_id) in the migration): value 1/-1 upserts the vote (same
 * value again keeps it, opposite value flips it), value 0 removes
 * it. Voting never verifies a deal — see services/community-deals.ts.
 * If the tables do not exist yet, returns 503 with an honest message.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, serviceUnavailable, validationError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';

import { logApiError } from '@/lib/api/error-logging';
function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01';
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  logApiRequest(request, { endpoint: 'community-deals/vote' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`community-deals.id.vote:${getClientIp(request)}`, 30);
  if (limited) return limited;

  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const body = await request.json().catch(() => null);
    const value = body?.value;
    if (value !== 1 && value !== -1 && value !== 0) {
      return validationError('value must be 1, -1, or 0 (remove vote).');
    }

    const supabase = await createSupabaseServerClient();
    if (value === 0) {
      const { error } = await supabase
        .from('community_deal_votes')
        .delete()
        .eq('deal_id', params.id)
        .eq('user_id', auth.userId);
      if (error) {
        if (isMissingTable(error)) {
          return serviceUnavailable('Community deals are not set up yet.');
        }
        return internalError('Failed to remove vote');
      }
      return apiSuccess({ dealId: params.id, value: 0 });
    }

    const { error } = await supabase.from('community_deal_votes').upsert(
      { deal_id: params.id, user_id: auth.userId, value },
      { onConflict: 'deal_id,user_id' }
    );
    if (error) {
      if (isMissingTable(error)) {
        return serviceUnavailable('Community deals are not set up yet.');
      }
      return internalError('Failed to save vote');
    }
    return apiSuccess({ dealId: params.id, value });
  } catch (err) {
    logApiError(err, { request, route: 'community-deals.vote', status: 500 });
    return internalError('Failed to save vote');
  }
}
