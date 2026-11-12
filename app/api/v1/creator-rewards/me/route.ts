/**
 * API v1 creator rewards — my rewards.
 * GET /api/v1/creator-rewards/me — the signed-in user's own
 * points, verified-deal count, badge, and next badge.
 *
 * Auth required. Fail-safe: if migration 031 has not been run yet,
 * or the user has never earned a reward, returns the honest zero
 * state — never invented points.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logger } from '@/lib/config/logger';
import { logApiRequest, rateLimitResponse, requireAuth, getClientIp } from '@/lib/api/middleware';
import {
  badgeForVerifiedDeals,
  badgeLabel,
  getCreatorRevenueShareConfig,
  nextBadge,
} from '@/lib/creator-rewards';

export const dynamic = 'force-dynamic';

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'creator-rewards.me' });

  const limited = await rateLimitResponse(`creator-rewards.me:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('creator_rewards')
      .select('display_name, points, verified_deals')
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) {
        return apiSuccess(
          { points: 0, verifiedDeals: 0, badge: 'none', badgeLabel: badgeLabel('none'), nextBadge: nextBadge(0), displayName: null },
          200,
          { rewardsEnabled: false, revenueShareConfigured: getCreatorRevenueShareConfig().configured }
        );
      }
      logger.error('[creator-rewards.me] fetch error', { error: error instanceof Error ? error.message : error });
      return internalError('Failed to fetch rewards');
    }
    const verifiedDeals = (data as { verified_deals?: number } | null)?.verified_deals ?? 0;
    const badge = badgeForVerifiedDeals(verifiedDeals);
    return apiSuccess(
      {
        points: (data as { points?: number } | null)?.points ?? 0,
        verifiedDeals,
        badge,
        badgeLabel: badgeLabel(badge),
        nextBadge: nextBadge(verifiedDeals),
        displayName: (data as { display_name?: string | null } | null)?.display_name ?? null,
      },
      200,
      { rewardsEnabled: true, revenueShareConfigured: getCreatorRevenueShareConfig().configured }
    );
  } catch {
    return internalError('Failed to fetch rewards');
  }
}
