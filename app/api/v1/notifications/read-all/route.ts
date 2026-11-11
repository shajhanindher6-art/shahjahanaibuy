/**
 * API v1 bulk mark-read endpoint.
 * POST /api/v1/notifications/read-all — mark all of the
 * authenticated user's notifications read (or unread).
 *
 * Section 14, Chunk 1 — the notifications page used to mark all
 * read by firing one PATCH per unread row. One call now does the
 * whole mailbox server-side. Body: { read: boolean } (required).
 * Read state lives in each row's jsonb `data` column
 * ({...data, read}) — notification_queue has no read column, and
 * the delivery `status` is untouched, same as the single-row
 * PATCH. Bounded to 500 rows (NOTIFICATIONS_FETCH_CAP): a mailbox
 * larger than that keeps its oldest rows untouched, and the
 * response says so via `total` vs `updated`.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { NOTIFICATIONS_FETCH_CAP, isNotificationRead } from '@/lib/notifications';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'notifications.readAll' });
  // Bulk write: tighter cap than the single-row PATCH.
  const limited = await rateLimitResponse(`notifications.readAll:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const read = (body as { read?: unknown } | null)?.read;
    if (typeof read !== 'boolean') {
      return badRequest('read must be a boolean');
    }

    const supabase = await createSupabaseServerClient();
    const { data: rows, error: fetchError } = await supabase
      .from('notification_queue')
      .select('id, data')
      .eq('user_id', auth.userId)
      .limit(NOTIFICATIONS_FETCH_CAP);
    if (fetchError) {
      return internalError('Failed to mark notifications');
    }

    const toUpdate = (rows ?? []).filter(
      (row) => isNotificationRead(row as { data?: { read?: boolean } | null }) !== read
    );
    let updated = 0;
    for (const row of toUpdate) {
      const prevData =
        row.data && typeof row.data === 'object' && !Array.isArray(row.data)
          ? (row.data as Record<string, unknown>)
          : {};
      const { error: updateError } = await supabase
        .from('notification_queue')
        .update({ data: { ...prevData, read } })
        .eq('id', row.id)
        .eq('user_id', auth.userId);
      if (updateError) {
        return internalError('Failed to mark notifications');
      }
      updated += 1;
    }

    return apiSuccess({ updated, total: (rows ?? []).length });
  } catch {
    return internalError('Failed to mark notifications');
  }
}
