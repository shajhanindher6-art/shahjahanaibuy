/**
 * Weekly digest cron endpoint.
 * POST /api/v1/notifications/digest — generates weekly digests for all Premium users.
 * Intended to be called weekly by a cron scheduler.
 *
 * Section 15, P4-2 — SERVICE-ROLE client (was the cookie-based
 * anon-key server client): generateWeeklyDigest inserts into
 * weekly_digests / notification_queue, which grant INSERT only TO
 * authenticated, so the old client failed both inserts silently
 * while the endpoint still reported `generated: N`. The service
 * client bypasses RLS; generateWeeklyDigest now returns null when
 * the digest row was not stored, and only stored digests are
 * counted. Plan filter is 'premium' after tier unification
 * (P2-2) — legacy 'pro' rows are still included for one release
 * (see DIGEST_PLANS in services/notifications.ts).
 *
 * No new scheduler is created for this endpoint: the single
 * cron-job.org job POSTs /api/v1/prices/refresh every 6h, and the
 * refresh chain calls generateWeeklyDigestsForPremiumUsers on a
 * weekly cadence. This endpoint remains for manual / weekly runs.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, unauthorized, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { isCronAuthorized } from '@/lib/api/cron-auth';
import { generateWeeklyDigest, DIGEST_PLANS } from '@/services/notifications';
import { logger } from '@/lib/config/logger';

import { logApiError } from '@/lib/api/error-logging';
/**
 * Section 18, item 36 — `maxDuration` (see
 * app/api/v1/notifications/process/route.ts for the plan
 * constraint): Vercel Hobby caps serverless execution at 60s —
 * DO NOT raise without a paid plan.
 */
export const maxDuration = 60;

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'notifications.digest' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`notifications.digest:${getClientIp(request)}`, 30);
  if (limited) return limited;

  // Fail CLOSED (security fix 2026-11-05): the old `if (cronSecret)` check
  // let anyone call this endpoint when the secret was unset. Same pattern
  // as prices/refresh and alerts/check.
  // Section 17, Stage G (§4 #11): timing-safe compare via
  // lib/api/cron-auth.ts.
  if (!process.env.CRON_SECRET) {
    return internalError(
      'CRON_SECRET is not configured; set it in the hosting dashboard before scheduling this endpoint'
    );
  }
  if (!isCronAuthorized(request)) {
    return unauthorized('Invalid cron secret');
  }

  // Service-role client: the digest inserts must bypass the
  // authenticated-only RLS policies on weekly_digests and
  // notification_queue (see header). Without the service key the
  // endpoint fails fast instead of silently generating zero
  // digests and reporting success.
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return internalError(
      'SUPABASE_SERVICE_ROLE_KEY is not configured; digest generation requires the service-role client'
    );
  }

  try {
    // Premium subscribers (legacy 'pro' rows included — P2-2).
    const { data: subs, error } = await supabase
      .from('subscriptions')
      .select('user_id')
      .in('plan', [...DIGEST_PLANS])
      .eq('status', 'active');

    if (error || !subs) {
      return internalError('Failed to fetch Premium users');
    }

    let generated = 0;
    let failed = 0;
    for (const sub of subs as Array<{ user_id: string }>) {
      // generateWeeklyDigest returns null when the digest row was
      // NOT stored (P4-2) — only stored digests are counted.
      const result = await generateWeeklyDigest(supabase, sub.user_id);
      if (result) generated++;
      else failed++;
    }

    logger.info('Weekly digest generated', { count: generated, failed, total: subs.length });
    return apiSuccess({ generated, failed, total: subs.length });
  } catch (err) {
    logApiError(err, { request, route: 'notifications.digest', status: 500 });
    return internalError('Failed to generate weekly digests');
  }
}
