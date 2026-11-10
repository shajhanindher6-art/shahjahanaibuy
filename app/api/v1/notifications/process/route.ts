/**
 * Notification queue processor (cron endpoint).
 * POST /api/v1/notifications/process — drains the notification queue.
 * Intended to be called by a cron scheduler (e.g. Supabase scheduled function).
 * Protected by a CRON_SECRET header check.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, unauthorized, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { processNotificationQueue } from '@/services/notification-dispatch';
import { generateWeeklyDigest } from '@/services/notifications';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'notifications.process' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`notifications.process:${getClientIp(request)}`, 30);
  if (limited) return limited;

  // Fail CLOSED (security fix 2026-11-05): the old `if (cronSecret)` check
  // let anyone call this endpoint when the secret was unset — and this
  // drains the queue that sends email/WhatsApp/Telegram. Same pattern
  // as prices/refresh and alerts/check.
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

  try {
    const supabase = await createSupabaseServerClient();
    const result = await processNotificationQueue(supabase);
    return apiSuccess(result);
  } catch {
    return internalError('Failed to process notification queue');
  }
}
