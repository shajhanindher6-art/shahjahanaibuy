/**
 * API v1 notifications endpoint.
 * GET /api/v1/notifications — list queued notifications for the authenticated user.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'notifications' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('notification_queue')
      .select('*')
      .eq('user_id', auth.userId)
      .order('scheduled_for', { ascending: false });

    if (error) {
      return internalError('Failed to fetch notifications');
    }

    return apiSuccess(data ?? []);
  } catch {
    return internalError('Failed to fetch notifications');
  }
}
