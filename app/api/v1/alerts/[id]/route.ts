/**
 * API v1 alert detail endpoint.
 * PATCH  /api/v1/alerts/[id] — update an alert (auth required, owner only).
 * DELETE /api/v1/alerts/[id] — delete an alert (auth required, owner only).
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
import {
  updateAlert,
  deleteAlert,
  type UpdateAlertInput,
} from '@/services/alerts';

import { logApiError } from '@/lib/api/error-logging';
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'alerts.update', id: params.id });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`alerts.id:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { alertType, conditionValue, channel, active } = body ?? {};

    const input: UpdateAlertInput = {};
    if (typeof alertType === 'string') input.alertType = alertType as UpdateAlertInput['alertType'];
    if (conditionValue !== undefined) input.conditionValue = conditionValue;
    if (typeof channel === 'string') input.channel = channel as UpdateAlertInput['channel'];
    if (typeof active === 'boolean') input.active = active;

    if (Object.keys(input).length === 0) {
      return badRequest('No fields to update');
    }

    const supabase = await createSupabaseServerClient();
    const updated = await updateAlert(supabase, params.id, auth.userId, input);

    if (!updated) {
      return notFound('Alert not found or not owned by user');
    }

    return apiSuccess(updated);
  } catch (err) {
    logApiError(err, { request, route: 'alerts.patch', status: 500 });
    return internalError('Failed to update alert');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'alerts.delete', id: params.id });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`alerts.id:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const deleted = await deleteAlert(supabase, params.id, auth.userId);

    if (!deleted) {
      return notFound('Alert not found or not owned by user');
    }

    return apiSuccess({ id: params.id, deleted: true });
  } catch (err) {
    logApiError(err, { request, route: 'alerts.delete', status: 500 });
    return internalError('Failed to delete alert');
  }
}
