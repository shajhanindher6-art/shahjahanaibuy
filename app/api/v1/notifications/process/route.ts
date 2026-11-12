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
  } catch {
    return internalError('Failed to process notification queue');
  }
}
