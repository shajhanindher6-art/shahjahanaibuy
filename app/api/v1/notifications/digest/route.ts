/**
 * Weekly digest cron endpoint.
 * POST /api/v1/notifications/digest — generates weekly digests for all Pro users.
 * Intended to be called weekly by a cron scheduler.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, unauthorized, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { generateWeeklyDigest } from '@/services/notifications';
import { logger } from '@/lib/config/logger';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'notifications.digest' });

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return unauthorized('Invalid cron secret');
    }
  }

  try {
    const supabase = await createSupabaseServerClient();

    // Get all Pro users
    const { data: subs, error } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('plan', 'pro')
      .eq('status', 'active');

    if (error || !subs) {
      return internalError('Failed to fetch Pro users');
    }

    let generated = 0;
    for (const sub of subs as Array<{ user_id: string }>) {
      const result = await generateWeeklyDigest(supabase, sub.user_id);
      if (result) generated++;
    }

    logger.info('Weekly digest generated', { count: generated, total: subs.length });
    return apiSuccess({ generated, total: subs.length });
  } catch {
    return internalError('Failed to generate weekly digests');
  }
}
