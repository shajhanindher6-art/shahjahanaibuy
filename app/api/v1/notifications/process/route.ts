/**
 * Notification queue processor (cron endpoint).
 * POST /api/v1/notifications/process — drains the notification queue.
 * Intended to be called by a cron scheduler (e.g. Supabase scheduled function).
 * Protected by a CRON_SECRET header check.
 *
 * Section 15, P4-2 — SERVICE-ROLE client (was the cookie-based
 * anon-key server client): processNotificationQueue reads and
 * updates queue rows belonging to every user, which the
 * authenticated-only RLS policies on notification_queue hide from
 * an anon/authenticated client. Same pattern as alerts/check and
 * prices/refresh.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, unauthorized, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { isCronAuthorized } from '@/lib/api/cron-auth';
import { processNotificationQueue } from '@/services/notification-dispatch';

import { logApiError } from '@/lib/api/error-logging';
/**
 * Section 18, item 36 — `maxDuration` for the long-running cron
 * routes (refresh, alerts/check, data/refresh, notifications
 * process + digest). Vercel's free (Hobby) plan caps serverless
 * execution at 60 seconds, so 60 is the safe ceiling — DO NOT
 * raise it without a paid plan (Pro: 300s, Enterprise: 900s).
 * Without this, the platform kills the 11-step synchronous chain
 * mid-run and the run row stays `running` until the next trigger
 * marks it `failed` after the 30-minute staleness window. The
 * value does NOT make a 60s+ chain finish — the refresh chain
 * must still be kept under the cap by bounded work (items 31/37).
 */
export const maxDuration = 60;

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'notifications.process' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`notifications.process:${getClientIp(request)}`, 30);
  if (limited) return limited;

  // Fail CLOSED (security fix 2026-11-05): the old `if (cronSecret)` check
  // let anyone call this endpoint when the secret was unset — and this
  // drains the queue that sends email/WhatsApp/Telegram. Same pattern
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

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return internalError(
      'SUPABASE_SERVICE_ROLE_KEY is not configured; notification processing requires the service-role client'
    );
  }

  try {
    const result = await processNotificationQueue(supabase);
    return apiSuccess(result);
  } catch (err) {
    logApiError(err, { request, route: 'notifications.process', status: 500 });
    return internalError('Failed to process notification queue');
  }
}
