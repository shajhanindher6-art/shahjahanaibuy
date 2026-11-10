/**
 * API v1 Receipt Vault item endpoints (Option 8, Feature 3).
 * DELETE /api/v1/vault/[id] — delete the signed-in user's own vault item.
 * PATCH  /api/v1/vault/[id] — update reorder fields only (Section 6,
 *        Item 3): isConsumable, reorderIntervalDays, reorderReminder.
 *        Nothing is auto-ordered; the fields only drive the derived
 *        next-reorder date shown on the vault page. Returns 503 until
 *        migration 033 has been run once.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
  notFound,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { normalizeReorderIntervalDays } from '@/lib/vault-reorder';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'vault.update', id: params.id });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`vault.id:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const updates: Record<string, unknown> = {};
    if (body?.isConsumable !== undefined) {
      if (typeof body.isConsumable !== 'boolean') {
        return badRequest('isConsumable must be a boolean.');
      }
      updates.is_consumable = body.isConsumable;
    }
    if (body?.reorderIntervalDays !== undefined) {
      const days = normalizeReorderIntervalDays(body.reorderIntervalDays);
      if (days === null && body.reorderIntervalDays !== null) {
        return badRequest('reorderIntervalDays must be a whole number of days between 1 and 3650.');
      }
      updates.reorder_interval_days = days;
    }
    if (body?.reorderReminder !== undefined) {
      if (typeof body.reorderReminder !== 'boolean') {
        return badRequest('reorderReminder must be a boolean.');
      }
      updates.reorder_reminder = body.reorderReminder;
    }
    if (Object.keys(updates).length === 0) {
      return badRequest(
        'Nothing to update — pass isConsumable, reorderIntervalDays, or reorderReminder.'
      );
    }
    // Turning off consumable clears the interval + reminder so stale
    // values never resurface as a reorder suggestion later.
    if (updates.is_consumable === false) {
      updates.reorder_interval_days = null;
      updates.reorder_reminder = false;
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('vault_items')
      .update(updates)
      .eq('id', params.id)
      .eq('user_id', auth.userId)
      .select('id');
    if (error) {
      if (error.code === '42703') {
        return serviceUnavailable(
          'Reorder fields are not live yet — the owner still needs to run migration 033 once.'
        );
      }
      return internalError('Failed to update vault item');
    }
    if (!data || data.length === 0) return notFound('Vault item not found');
    return apiSuccess({ id: params.id, ...updates });
  } catch {
    return internalError('Failed to update vault item');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'vault.delete', id: params.id });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`vault.id:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('vault_items')
      .delete()
      .eq('id', params.id)
      .eq('user_id', auth.userId)
      .select('id');
    if (error) return internalError('Failed to delete vault item');
    if (!data || data.length === 0) return notFound('Vault item not found');
    return apiSuccess({ deleted: true });
  } catch {
    return internalError('Failed to delete vault item');
  }
}
