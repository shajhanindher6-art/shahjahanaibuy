/**
 * API v1 notifications endpoint.
 * GET /api/v1/notifications — list queued notifications for the authenticated user.
 *
 * Section 14, Chunk 1 — ?limit=&offset=&type=&read= (the page
 * already sent ?limit=20, which this route silently ignored).
 * limit clamps to 1–100 (default 20), offset defaults to 0, type
 * is an exact match on the notification type, read is 'read' /
 * 'unread' / 'all'. Filtering and paging are applied in memory by
 * lib/notifications.ts over a bounded fetch (500 rows, newest
 * first) — see that module for why the jsonb read flag is not
 * filtered in the query. Response rows are mapped to the page's
 * camelCase shape (scheduledFor/sentAt/createdAt); the old
 * verbatim select('*') left those undefined and every date
 * rendered "Invalid Date". meta carries the filtered total, the
 * global unread count (for the sidebar badge), and the applied
 * limit/offset.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  NOTIFICATIONS_FETCH_CAP,
  applyNotificationsListQuery,
  mapNotificationRow,
  parseNotificationsListQuery,
  type NotificationDbRow,
} from '@/lib/notifications';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'notifications' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`notifications:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const query = parseNotificationsListQuery(request.nextUrl.searchParams);

  try {
    const supabase = await createSupabaseServerClient();
    // Section 18, item 30 — explicit columns (was select('*')):
    // exactly the fields mapNotificationRow reads.
    const { data, error } = await supabase
      .from('notification_queue')
      .select('id, user_id, type, channel, subject, body, data, status, scheduled_for, sent_at, created_at')
      .eq('user_id', auth.userId)
      .order('scheduled_for', { ascending: false })
      .limit(NOTIFICATIONS_FETCH_CAP);

    if (error) {
      return internalError('Failed to fetch notifications');
    }

    const mapped = ((data ?? []) as unknown as NotificationDbRow[]).map(mapNotificationRow);
    const { page, total, unreadCount } = applyNotificationsListQuery(mapped, query);

    return apiSuccess(page, 200, {
      total,
      unreadCount,
      limit: query.limit,
      offset: query.offset,
    });
  } catch {
    return internalError('Failed to fetch notifications');
  }
}
