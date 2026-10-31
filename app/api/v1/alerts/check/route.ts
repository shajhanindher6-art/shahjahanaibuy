/**
 * Price alert checker (cron endpoint).
 * POST /api/v1/alerts/check — check all active alerts against current
 * prices, queue notifications for triggered alerts, then drain the
 * notification queue so triggered alerts are sent in the same run.
 *
 * Intended to be called by a cron scheduler (for example a free
 * external scheduler) on a regular cadence, e.g. once or twice a day.
 * Protected by a CRON_SECRET header check, the same pattern as
 * /api/v1/notifications/process. Uses the service-role client because
 * the checker must read alerts belonging to every user; the
 * owner-scoped RLS policies on `alerts` would hide other users'
 * alerts from an anon/authenticated client.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard. If it
 * is not set, the endpoint returns a clear error instead of running
 * as anon and silently checking zero alerts.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, unauthorized, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { checkPriceAlerts } from '@/services/alert-checker';
import { processNotificationQueue } from '@/services/notification-dispatch';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'alerts.check' });

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
      'SUPABASE_SERVICE_ROLE_KEY is not configured; alert checking requires the service-role client'
    );
  }

  try {
    const alerts = await checkPriceAlerts(supabase);
    const notifications = await processNotificationQueue(supabase);

    return apiSuccess({ alerts, notifications });
  } catch {
    return internalError('Failed to check price alerts');
  }
}
