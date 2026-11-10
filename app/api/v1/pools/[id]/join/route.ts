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
    return apiSuccess({ joined: true }, 201);
  } catch {
    return internalError('Failed to join pool');
  }
}
