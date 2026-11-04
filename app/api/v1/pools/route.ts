/**
 * API v1 SmartPool endpoints (Option 8, Feature 2).
 * GET  /api/v1/pools?productId=… — open pools for a product, with real
 *        member counts (never invented).
 * POST /api/v1/pools — create a pool (auth required). The creator becomes
 *        member #1; the count only grows by real joins.
 *
 * Graceful degradation: if supabase/add-smartpools.sql has not been run
 * yet, GET returns { pools: [], poolsEnabled: false } and POST returns
 * 503 with an honest message. Reaching a threshold NEVER promises a
 * discount — see POOL_NO_GUARANTEE_NOTE in services/smartpool.ts.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';

// PostgREST reports a table missing from its schema cache as PGRST205
// (not Postgres 42P01) on the REST path, so both codes must count as
// "migration not run yet" — otherwise a missing table surfaces as a
// generic INTERNAL_ERROR instead of the honest enabled:false flag.
function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'pools' });
  const productId = request.nextUrl.searchParams.get('productId');

  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase
      .from('pools')
      .select('id, product_id, product_name, region_code, threshold, creator_id, status, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(50);
    if (productId) query = query.eq('product_id', productId);
    const { data: pools, error } = await query;
    if (error) {
      // Logged server-side only (never exposed to visitors): without
      // this, a query failure is invisible in Vercel Runtime Logs —
      // the route just returns a generic 500 with no error detail.
      console.error('[pools] fetch error', error);
      if (isMissingTable(error)) return apiSuccess([], 200, { poolsEnabled: false });
      return internalError('Failed to fetch pools');
    }
    const rows = pools ?? [];
    if (rows.length === 0) return apiSuccess([], 200, { poolsEnabled: true });
    const { data: members } = await supabase
      .from('pool_members')
      .select('pool_id')
      .in('pool_id', rows.map((p: { id: string }) => p.id));
    const counts = new Map<string, number>();
    for (const m of (members ?? []) as Array<{ pool_id: string }>) {
      counts.set(m.pool_id, (counts.get(m.pool_id) ?? 0) + 1);
    }
    return apiSuccess(
      rows.map((p: Record<string, unknown>) => ({
        ...p,
        memberCount: counts.get(p.id as string) ?? 0,
      })),
      200,
      { poolsEnabled: true }
    );
  } catch (err) {
    console.error('[pools] unexpected error', err);
    return internalError('Failed to fetch pools');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'pools.create' });
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const productId = typeof body?.productId === 'string' ? body.productId : null;
    const productName = typeof body?.productName === 'string' ? body.productName.trim() : '';
    const regionCode =
      typeof body?.regionCode === 'string' && body.regionCode.trim()
        ? body.regionCode.trim().toUpperCase()
        : 'US';
    const threshold = Math.max(2, Math.floor(Number(body?.threshold) || 10));
    if (!productName) return badRequest('productName is required');

    const supabase = await createSupabaseServerClient();
    const { data: pool, error } = await supabase
      .from('pools')
      .insert({
        product_id: productId,
        product_name: productName,
        region_code: regionCode,
        threshold,
        creator_id: auth.userId,
        status: 'open',
      })
      .select('id, product_id, product_name, region_code, threshold, creator_id, status, created_at')
      .single();
    if (error || !pool) {
      if (isMissingTable(error)) {
        return serviceUnavailable(
          'SmartPools are not live yet — the owner still needs to run supabase/add-smartpools.sql.'
        );
      }
      return internalError('Failed to create pool');
    }
    // Creator is member #1 (best effort — the pool exists regardless).
    await supabase.from('pool_members').insert({ pool_id: pool.id, user_id: auth.userId });
    return apiSuccess({ ...pool, memberCount: 1 }, 201);
  } catch {
    return internalError('Failed to create pool');
  }
}
