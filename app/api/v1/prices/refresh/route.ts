/**
 * Price refresh worker endpoint (scheduled, not user-facing).
 * POST /api/v1/prices/refresh — one scheduled run of the full chain:
 *
 *   1. refreshTrackedPrices(): record any changed catalog price for
 *      alerted / wishlisted products as a new price_history row.
 *   2. checkPriceAlerts(): compare active alerts with the new prices
 *      and queue notifications for triggered alerts.
 *   3. processNotificationQueue(): drain the queue, sending the
 *      price-drop emails via Resend (services/email.ts).
 *
 * Protected by CRON_SECRET, the same pattern as /api/v1/alerts/check
 * and /api/v1/notifications/process. Uses the service-role client
 * because the refresh and checker must read alerts and wishlist
 * items belonging to every user. Requires
 * SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard; without it the
 * endpoint fails fast instead of silently checking zero alerts.
 *
 * Intended caller: the free GitHub Actions workflow in
 * .github/workflows/price-refresh.yml (daily), or the Supabase Edge
 * Function in supabase/functions/price-refresh-worker/ — either way,
 * one call per run, not one per user or product.
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
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return unauthorized('Invalid cron secret');
    }
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
