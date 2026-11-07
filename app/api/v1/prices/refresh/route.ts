/**
 * Price refresh worker endpoint (scheduled, not user-facing).
 * POST /api/v1/prices/refresh — one scheduled run of the full chain:
 *
 *   1. refreshTrackedPrices(): record any changed catalog price for
 *      alerted / wishlisted products as a new price_history row.
 *   2. checkPriceAlerts(): compare active alerts with the new prices
 *      and queue notifications for triggered alerts.
 *   3. processNotificationQueue(): drain the queue, sending email
 *      (Resend), web push (VAPID), and WhatsApp/Telegram webhook
 *      alerts for every enabled channel, and leaving an in-app
 *      notification row for every alert even when email/push
 *      providers are unconfigured.
 *
 * SINGLE-SCHEDULER RULE — THIS IS THE CANONICAL TRIGGER (see
 * docs/alerts-delivery-setup.md): schedule exactly ONE free cron job
 * (e.g. cron-job.org) that POSTs to this endpoint, e.g. every
 * 6 hours. Do NOT also schedule /api/v1/alerts/check (it runs the
 * same chain and exists for manual runs), and do NOT also schedule
 * the Supabase price-refresh-worker Edge Function (it calls this
 * same endpoint). Pick ONE trigger, never two — a second trigger
 * only re-runs the same chain per cadence.
 *
 * Protected by CRON_SECRET: the secret must be set in the hosting
 * dashboard, and the caller must send `Authorization: Bearer
 * <CRON_SECRET>`. When CRON_SECRET is unset the endpoint refuses to
 * run (fail closed) instead of accepting unauthenticated trigger
 * calls. Uses the service-role client because the refresh and
 * checker must read alerts and wishlist items belonging to every
 * user. Requires SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard;
 * without it the endpoint fails fast instead of silently checking
 * zero alerts.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, unauthorized, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { refreshTrackedPrices } from '@/services/price-refresh';
import { checkPriceAlerts } from '@/services/alert-checker';
import { processNotificationQueue } from '@/services/notification-dispatch';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'prices.refresh' });

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
      'SUPABASE_SERVICE_ROLE_KEY is not configured; price refresh requires the service-role client'
    );
  }

  try {
    const refresh = await refreshTrackedPrices(supabase);
    const alerts = await checkPriceAlerts(supabase);
    const notifications = await processNotificationQueue(supabase);

    return apiSuccess({ refresh, alerts, notifications });
  } catch {
    return internalError('Failed to refresh prices');
  }
}
