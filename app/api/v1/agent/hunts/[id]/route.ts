/**
 * API v1 single agent hunt endpoint — Section 6, item 2.
 * PATCH  /api/v1/agent/hunts/[id] — toggle `active` only.
 * DELETE /api/v1/agent/hunts/[id] — delete the hunt (its matches
 *        are removed by the migration 033 ON DELETE CASCADE).
 *
 * Ownership is verified server-side (hunt.user_id === caller) on
 * every operation; RLS is the second layer, never the only one.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError, notFound, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import { isMissingTableError, mapHuntRow } from '@/lib/agent-hunt';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const HUNT_COLUMNS =
  'id, user_id, category, max_budget_usd, preferred_brands, active, last_run_at, created_at';

async function loadOwnedHunt(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  id: string,
  userId: string
) {
  const { data, error } = await supabase
    .from('agent_hunts')
    .select(HUNT_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { error };
  if (!data) return { hunt: null };
  return { hunt: mapHuntRow(data as Record<string, unknown>) };
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  logApiRequest(request, { endpoint: 'agent.hunts.update' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`agent-hunts:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    if (body?.active === undefined) {
      return badRequest('Nothing to update — pass active (boolean).');
    }
    if (typeof body.active !== 'boolean') {
      return badRequest('active must be a boolean.');
    }

    const supabase = await createSupabaseServerClient();
    const loaded = await loadOwnedHunt(supabase, params.id, auth.userId);
    if ('error' in loaded && loaded.error) {
      if (isMissingTableError(loaded.error)) {
        return serviceUnavailable('Agent hunts are not set up yet — the owner still needs to run migration 033 once.');
      }
      return internalError('Failed to update agent hunt');
    }
    if (!loaded.hunt) return notFound('Hunt not found');

    const { data, error } = await supabase
      .from('agent_hunts')
      .update({ active: body.active })
      .eq('id', params.id)
      .eq('user_id', auth.userId)
      .select(HUNT_COLUMNS)
      .maybeSingle();
    if (error || !data) return internalError('Failed to update agent hunt');
    return apiSuccess({ hunt: mapHuntRow(data as Record<string, unknown>), huntsEnabled: true });
  } catch (err) {
    logApiError(err, { request, route: 'agent.hunts.patch', status: 500 });
    return internalError('Failed to update agent hunt');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  logApiRequest(request, { endpoint: 'agent.hunts.delete' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`agent-hunts:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const loaded = await loadOwnedHunt(supabase, params.id, auth.userId);
    if ('error' in loaded && loaded.error) {
      if (isMissingTableError(loaded.error)) {
        return serviceUnavailable('Agent hunts are not set up yet — the owner still needs to run migration 033 once.');
      }
      return internalError('Failed to delete agent hunt');
    }
    if (!loaded.hunt) return notFound('Hunt not found');

    const { error } = await supabase
      .from('agent_hunts')
      .delete()
      .eq('id', params.id)
      .eq('user_id', auth.userId);
    if (error) return internalError('Failed to delete agent hunt');
    return apiSuccess({ deleted: true });
  } catch (err) {
    logApiError(err, { request, route: 'agent.hunts.delete', status: 500 });
    return internalError('Failed to delete agent hunt');
  }
}
