/**
 * Price alert checker (cron endpoint).
 * POST /api/v1/alerts/check — one scheduled run of the full chain:
 *
 *   1. refreshTrackedPrices(): record any changed catalog price for
 *      alerted / wishlisted products as a new price_history row.
 *   2. checkPriceAlerts(): compare active alerts with the new prices
 *      and queue notifications for triggered alerts.
 *   3. processNotificationQueue(): drain the queue, sending email
 *      (Resend) and web push (VAPID) for every enabled channel.
 *
 * SINGLE-SCHEDULER RULE (see docs/alerts-delivery-setup.md): schedule
 * exactly ONE trigger — POST /api/v1/prices/refresh from one free
 * cron job (e.g. cron-job.org). This endpoint exists so that either
 * endpoint alone covers the whole chain (useful for a manual run or
 * a health check), but scheduling BOTH endpoints, or additionally
 * scheduling the Supabase price-refresh-worker Edge Function, would
 * run the chain twice per cadence. Pick ONE, never both.
 *
 * Protected by CRON_SECRET: the secret must be set in the hosting
 * dashboard, and the caller must send `Authorization: Bearer
 * <CRON_SECRET>`. When CRON_SECRET is unset the endpoint refuses to
 * run (fail closed) instead of accepting unauthenticated trigger
 * calls. Uses the service-role client because the refresh and
 * checker must read alerts and wishlist items belonging to every
 * user; the owner-scoped RLS policies would hide other users' rows
 * from an anon/authenticated client.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard. If it
 * is not set, the endpoint returns a clear error instead of running
 * as anon and silently checking zero alerts.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, unauthorized, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { refreshTrackedPrices } from '@/services/price-refresh';
import { checkPriceAlerts } from '@/services/alert-checker';
import { processNotificationQueue } from '@/services/notification-dispatch';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'alerts.check' });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return internalError(
      'CRON_SECRET is not configured; set it in the hosting dashboard before scheduling this endpoint'
    );
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized('Invalid cron secret');
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return internalError(
      'SUPABASE_SERVICE_ROLE_KEY is not configured; alert checking requires the service-role client'
    );
  }

  try {
    const refresh = await refreshTrackedPrices(supabase);
    const alerts = await checkPriceAlerts(supabase);
    const notifications = await processNotificationQueue(supabase);

    return apiSuccess({ refresh, alerts, notifications });
  } catch {
    return internalError('Failed to check price alerts');
  }
}
