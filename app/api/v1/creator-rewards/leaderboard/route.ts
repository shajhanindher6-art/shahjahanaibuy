/**
 * API v1 creator rewards — leaderboard.
 * GET /api/v1/creator-rewards/leaderboard — public top contributors.
 *
 * Reads creator_rewards (migration 031) ordered by points desc.
 * Fail-safe: if the migration has not been run yet, returns an
 * honest empty leaderboard with rewardsEnabled:false — never a
 * crash, never invented contributors. No personal data is exposed:
 * rows carry only user id, display name, points, verified deals,
 * and badge. Revenue share is reported only as "configured or not"
 * (lib/creator-rewards.ts) — no amounts, no payouts.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logger } from '@/lib/config/logger';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  badgeForVerifiedDeals,
  getCreatorRevenueShareConfig,
  rankLeaderboard,
  type LeaderboardEntry,
} from '@/lib/creator-rewards';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'creator-rewards.leaderboard' });

  const limited = await rateLimitResponse(`creator-rewards.leaderboard:${getClientIp(request)}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('creator_rewards')
      .select('user_id, display_name, points, verified_deals, badge')
      .order('points', { ascending: false })
      .order('verified_deals', { ascending: false })
      .limit(20);
    if (error) {
      if (isMissingTable(error)) {
        return apiSuccess([], 200, {
          rewardsEnabled: false,
          revenueShareConfigured: getCreatorRevenueShareConfig().configured,
        });
      }
      logger.error('[creator-rewards.leaderboard] fetch error', { error: error instanceof Error ? error.message : error });
      return internalError('Failed to fetch leaderboard');
    }
    const entries: LeaderboardEntry[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      userId: row.user_id as string,
      displayName: (row.display_name as string | null) ?? null,
      points: (row.points as number) ?? 0,
      verifiedDeals: (row.verified_deals as number) ?? 0,
      badge: badgeForVerifiedDeals((row.verified_deals as number) ?? 0),
    }));
    return apiSuccess(rankLeaderboard(entries), 200, {
      rewardsEnabled: true,
      revenueShareConfigured: getCreatorRevenueShareConfig().configured,
    });
  } catch (err) {
    logApiError(err, { request, route: 'creator-rewards.leaderboard', status: 500 });
    return internalError('Failed to fetch leaderboard');
  }
}
