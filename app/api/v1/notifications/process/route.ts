/**
 * Notification queue processor (cron endpoint).
 * POST /api/v1/notifications/process — drains the notification queue.
 * Intended to be called by a cron scheduler (e.g. Supabase scheduled function).
 * Protected by a CRON_SECRET header check.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, unauthorized, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { processNotificationQueue } from '@/services/notification-dispatch';
import { generateWeeklyDigest } from '@/services/notifications';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'notifications.process' });

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return unauthorized('Invalid cron secret');
    }
  }

  try {
    const supabase = await createSupabaseServerClient();
    const result = await processNotificationQueue(supabase);
    return apiSuccess(result);
  } catch {
    return internalError('Failed to process notification queue');
  }
}
