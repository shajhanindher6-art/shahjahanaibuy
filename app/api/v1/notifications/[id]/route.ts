/**
 * API v1 notification detail endpoint.
 * PATCH /api/v1/notifications/[id] — mark a notification read or
 * unread (auth required, owner only). Section 13, item 58: the
 * notifications page imported CheckCheck but no mark-as-read
 * endpoint existed anywhere, so the icon did nothing.
 *
 * Read state lives in the row's jsonb `data` column
 * ({...data, read: true}) — notification_queue has no read column,
 * and adding one would need a migration. The delivery `status`
 * (pending/sent/…) is deliberately untouched: read/unread is about
 * the user having seen the row, not about delivery. The GET list
 * route returns the explicit column list (Section 18, item 30 —
 * was select('*')), so the flag round-trips to the page,
 * which dims read rows.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  notFound,
  internalError,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'notifications.markRead', id: params.id });
  // Rate limit: 60 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`notifications.id:${getClientIp(request)}`, 60);
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
    const { data: existing, error: fetchError } = await supabase
      .from('notification_queue')
      .select('id, data')
      .eq('id', params.id)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (fetchError) {
      return internalError('Failed to mark notification');
    }
    if (!existing) {
      return notFound('Notification not found or not owned by user');
    }

    const prevData =
      existing.data && typeof existing.data === 'object' && !Array.isArray(existing.data)
        ? (existing.data as Record<string, unknown>)
        : {};
    const { data: updated, error: updateError } = await supabase
      .from('notification_queue')
      .update({ data: { ...prevData, read } })
      .eq('id', params.id)
      .eq('user_id', auth.userId)
      // Section 18, item 30 — explicit columns (was select('*')):
      // the updated row is returned verbatim; the page maps it with
      // mapNotificationRow, so the list covers exactly its fields.
      .select('id, user_id, type, channel, subject, body, data, status, scheduled_for, sent_at, created_at')
      .maybeSingle();
    if (updateError) {
      return internalError('Failed to mark notification');
    }
    if (!updated) {
      return notFound('Notification not found or not owned by user');
    }

    return apiSuccess(updated);
  } catch {
    return internalError('Failed to mark notification');
  }
}
