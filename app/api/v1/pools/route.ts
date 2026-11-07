/**
 * API v1 SmartPool endpoints (Option 8, Feature 2).
 * GET  /api/v1/pools?productId=… — open pools for a product, with real
 *        member counts (never invented).
 * POST /api/v1/pools — create a pool (auth required). The creator becomes
 *        member #1; the count only grows by real joins.
 *
 * Graceful degradation: if supabase/add-smartpools.sql has not been run
 * yet, GET returns { pools: [], poolsEnabled: false } and POST returns
 * 503 with an honest message. If the 018 migration (city +
 * shipping_estimate_usd) has not been run yet, both fields degrade to
 * null and the UI shows the honest empty states. Reaching a threshold
 * NEVER promises a discount — see POOL_NO_GUARANTEE_NOTE in
 * services/smartpool.ts.
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

// The 018 migration columns (city, shipping_estimate_usd) may not
// exist yet: a missing column is 42703. Callers must degrade to
// "unknown" for both fields, never crash or fake a value.
function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703';
}

const POOL_SELECT_WITH_V2 =
  'id, product_id, product_name, region_code, city, shipping_estimate_usd, threshold, creator_id, status, created_at';
const POOL_SELECT_BASE =
  'id, product_id, product_name, region_code, threshold, creator_id, status, created_at';

/** Normalize one pool row for the client (camelCase, nulls for missing v2 fields). */
function normalizePool(p: Record<string, unknown>): Record<string, unknown> {
  return {
    ...p,
    city: typeof p.city === 'string' && p.city ? p.city : null,
    shippingEstimateUsd:
      typeof p.shipping_estimate_usd === 'number' ? p.shipping_estimate_usd : null,
  };
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'pools' });
  const productId = request.nextUrl.searchParams.get('productId');

  try {
    const supabase = await createSupabaseServerClient();
    const runQuery = async (select: string) => {
      let query = supabase
        .from('pools')
        .select(select)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(50);
      if (productId) query = query.eq('product_id', productId);
      return query;
    };
    let pools: Array<Record<string, unknown>> | null = null;
    let error: { code?: string } | null = null;
    {
      const first = await runQuery(POOL_SELECT_WITH_V2);
      pools = (first.data ?? null) as Array<Record<string, unknown>> | null;
      error = (first.error ?? null) as { code?: string } | null;
    }
    if (error && isMissingColumn(error)) {
      // 018 migration not run yet: retry without the v2 columns and
      // report null for both (honest unknown, never fake data).
      console.error('[pools] v2 columns missing, retrying without them', error);
      const retry = await runQuery(POOL_SELECT_BASE);
      pools = (retry.data ?? null) as Array<Record<string, unknown>> | null;
      error = (retry.error ?? null) as { code?: string } | null;
    }
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
      .in('pool_id', rows.map((p) => p.id as string));
    const counts = new Map<string, number>();
    for (const m of (members ?? []) as Array<{ pool_id: string }>) {
      counts.set(m.pool_id, (counts.get(m.pool_id) ?? 0) + 1);
    }
    return apiSuccess(
      rows.map((p) => ({
        ...normalizePool(p),
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
    // Optional v2 fields (018 migration): a shared city, and the
    // creator's own shipping estimate in USD. 0 / missing / invalid
    // means "no estimate" — never invent a shipping rate.
    const city =
      typeof body?.city === 'string' && body.city.trim()
        ? body.city.trim().slice(0, 100)
        : null;
    const shippingEstimateRaw = Number(body?.shippingEstimateUsd);
    const shippingEstimateUsd =
      Number.isFinite(shippingEstimateRaw) && shippingEstimateRaw > 0
        ? Math.round(shippingEstimateRaw * 100) / 100
        : null;
    if (!productName) return badRequest('productName is required');

    const supabase = await createSupabaseServerClient();
    const insertBase = {
      product_id: productId,
      product_name: productName,
      region_code: regionCode,
      threshold,
      creator_id: auth.userId,
      status: 'open',
    };
    let { data: pool, error } = await supabase
      .from('pools')
      .insert({ ...insertBase, city, shipping_estimate_usd: shippingEstimateUsd })
      .select(POOL_SELECT_WITH_V2)
      .single();
    if (error && isMissingColumn(error)) {
      // 018 migration not run yet: create the pool without the v2
      // columns. The pool still works; city/shipping stay unknown.
      console.error('[pools] v2 columns missing on create, retrying without them', error);
      ({ data: pool, error } = await supabase
        .from('pools')
        .insert(insertBase)
        .select(POOL_SELECT_BASE)
        .single());
    }
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
    return apiSuccess({ ...normalizePool(pool as Record<string, unknown>), memberCount: 1 }, 201);
  } catch {
    return internalError('Failed to create pool');
  }
}
