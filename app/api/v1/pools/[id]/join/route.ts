/**
 * API v1 SmartPool join endpoint (Option 8, Feature 2).
 * POST /api/v1/pools/[id]/join — join a pool (auth required, one
 * membership per user per pool via the UNIQUE constraint).
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
import { logApiError } from '@/lib/api/error-logging';
import { normalizeQuantity } from '@/lib/pool-quantities';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(_request, { endpoint: 'pools.join', id: params.id });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`pools.id.join:${getClientIp(_request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(_request);
  if ('error' in auth) return auth.error;

  // Optional committed quantity for this member (default 1 unit).
  // Invalid values count as 1 — a quantity is never a reason to
  // reject a join.
  const body = await _request.json().catch(() => null);
  const quantity = normalizeQuantity(body?.quantity);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: pool, error: poolError } = await supabase
      .from('pools')
      .select('id, status')
      .eq('id', params.id)
      .maybeSingle();
    if (poolError?.code === '42P01') {
      return serviceUnavailable(
        'SmartPools are not live yet — the owner still needs to run supabase/add-smartpools.sql.'
      );
    }
    if (poolError || !pool) return notFound('Pool not found');
    if (pool.status !== 'open') return badRequest('This pool is no longer open');

    const { error } = await supabase
      .from('pool_members')
      .insert({ pool_id: params.id, user_id: auth.userId });
    if (error) {
      if (error.code === '23505') return badRequest('You are already a member of this pool');
      return internalError('Failed to join pool');
    }
    // Record the member's quantity (best effort — a missing 033
    // table just means the member counts as 1 unit, today's
    // behaviour; the join itself already succeeded).
    await supabase
      .from('pool_member_quantities')
      .upsert({ pool_id: params.id, user_id: auth.userId, quantity }, { onConflict: 'pool_id,user_id' });
    return apiSuccess({ joined: true, quantity }, 201);
  } catch (err) {
    logApiError(err, { request: _request, route: 'pools.join', status: 500 });
    return internalError('Failed to join pool');
  }
}
