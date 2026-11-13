/**
 * API v1 SmartPool endpoints (Option 8, Feature 2; Section 6 Item 8).
 * GET  /api/v1/pools?productId=… — open pools for a product, with real
 *        member counts and real committed quantities (never invented).
 * POST /api/v1/pools — create a pool (auth required). The creator becomes
 *        member #1; the count only grows by real joins.
 *
 * Graceful degradation: if supabase/add-smartpools.sql has not been run
 * yet, GET returns { pools: [], poolsEnabled: false } and POST returns
 * 503 with an honest message. If the 018 migration (city +
 * shipping_estimate_usd) has not been run yet, both fields degrade to
 * null and the UI shows the honest empty states. If migration 033
 * (target_quantity, bulk_note, pool_member_quantities) has not been
 * run yet, quantities default to 1 per member and target/bulk-note
 * degrade to null — today's behaviour. Reaching a threshold NEVER
 * promises a discount — see POOL_NO_GUARANTEE_NOTE in
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
import { logger } from '@/lib/config/logger';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { normalizeQuantity, poolQuantityProgressText } from '@/lib/pool-quantities';

import { logApiError } from '@/lib/api/error-logging';
// PostgREST reports a table missing from its schema cache as PGRST205
// (not Postgres 42P01) on the REST path, so both codes must count as
// "migration not run yet" — otherwise a missing table surfaces as a
// generic INTERNAL_ERROR instead of the honest enabled:false flag.
function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

// The 018 migration columns (city, shipping_estimate_usd) and the 033
// columns (target_quantity, bulk_note) may not exist yet: a missing
// column is 42703. Callers must degrade to "unknown" for those
// fields, never crash or fake a value.
function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703';
}

const POOL_SELECT_WITH_V3 =
  'id, product_id, product_name, region_code, city, shipping_estimate_usd, target_quantity, bulk_note, threshold, creator_id, status, created_at';
const POOL_SELECT_WITH_V2 =
  'id, product_id, product_name, region_code, city, shipping_estimate_usd, threshold, creator_id, status, created_at';
const POOL_SELECT_BASE =
  'id, product_id, product_name, region_code, threshold, creator_id, status, created_at';

/** Normalize one pool row for the client (camelCase, nulls for missing v2/v3 fields). */
function normalizePool(p: Record<string, unknown>): Record<string, unknown> {
  return {
    ...p,
    city: typeof p.city === 'string' && p.city ? p.city : null,
    shippingEstimateUsd:
      typeof p.shipping_estimate_usd === 'number' ? p.shipping_estimate_usd : null,
    targetQuantity:
      typeof p.target_quantity === 'number' && p.target_quantity >= 2 ? p.target_quantity : null,
    bulkNote: typeof p.bulk_note === 'string' && p.bulk_note ? p.bulk_note : null,
  };
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'pools' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`pools:${getClientIp(request)}`, 120);
  if (limited) return limited;

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
      const first = await runQuery(POOL_SELECT_WITH_V3);
      pools = (first.data ?? null) as Array<Record<string, unknown>> | null;
      error = (first.error ?? null) as { code?: string } | null;
    }
    if (error && isMissingColumn(error)) {
      // 033 columns missing: retry without them (target/bulk-note
      // stay null — honest unknown, never fake data).
      logger.error('[pools] v3 columns missing, retrying without them', { error: error instanceof Error ? error.message : error });
      const retry = await runQuery(POOL_SELECT_WITH_V2);
      pools = (retry.data ?? null) as Array<Record<string, unknown>> | null;
      error = (retry.error ?? null) as { code?: string } | null;
    }
    if (error && isMissingColumn(error)) {
      // 018 migration not run yet: retry without the v2 columns and
      // report null for both (honest unknown, never fake data).
      logger.error('[pools] v2 columns missing, retrying without them', { error: error instanceof Error ? error.message : error });
      const retry = await runQuery(POOL_SELECT_BASE);
      pools = (retry.data ?? null) as Array<Record<string, unknown>> | null;
      error = (retry.error ?? null) as { code?: string } | null;
    }
    if (error) {
      // Logged server-side only (never exposed to visitors): without
      // this, a query failure is invisible in Vercel Runtime Logs —
      // the route just returns a generic 500 with no error detail.
      logger.error('[pools] fetch error', { error: error instanceof Error ? error.message : error });
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
    // Per-member quantities (033). Missing table = every member
    // counts as 1 unit (today's behaviour); the query error is
    // swallowed deliberately — quantities are an enhancement, not
    // a reason to fail the whole list.
    const quantitiesByPool = new Map<string, number[]>();
    const { data: quantities, error: quantitiesError } = await supabase
      .from('pool_member_quantities')
      .select('pool_id, quantity')
      .in('pool_id', rows.map((p) => p.id as string));
    if (!quantitiesError) {
      for (const q of (quantities ?? []) as Array<{ pool_id: string; quantity: number }>) {
        const list = quantitiesByPool.get(q.pool_id) ?? [];
        list.push(normalizeQuantity(q.quantity));
        quantitiesByPool.set(q.pool_id, list);
      }
    }
    return apiSuccess(
      rows.map((p) => {
        const id = p.id as string;
        const memberCount = counts.get(id) ?? 0;
        // Members without a recorded quantity row count as 1 unit.
        const quantities = quantitiesByPool.get(id) ?? [];
        const padded = [...quantities];
        while (padded.length < memberCount) padded.push(1);
        const targetQuantity =
          typeof p.target_quantity === 'number' && p.target_quantity >= 2 ? p.target_quantity : null;
        return {
          ...normalizePool(p),
          memberCount,
          totalQuantity: padded.reduce((sum, q) => sum + q, 0),
          quantityProgress: poolQuantityProgressText(
            memberCount,
            padded,
            typeof p.threshold === 'number' ? p.threshold : 0,
            targetQuantity
          ),
        };
      }),
      200,
      { poolsEnabled: true }
    );
  } catch (err) {
    logApiError(err, { request, route: 'pools.get', status: 500 });
    logger.error('[pools] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to fetch pools');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'pools.create' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`pools:${getClientIp(request)}`, 30);
  if (limited) return limited;

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
    // Optional v3 fields (033 migration): a target quantity
    // (>= 2 units, else no target) and a free-text bulk note from
    // the creator. Neither promises any discount or retailer offer.
    const targetQuantityRaw = Number(body?.targetQuantity);
    const targetQuantity =
      Number.isFinite(targetQuantityRaw) && targetQuantityRaw >= 2
        ? Math.floor(targetQuantityRaw)
        : null;
    const bulkNote =
      typeof body?.bulkNote === 'string' && body.bulkNote.trim()
        ? body.bulkNote.trim().slice(0, 500)
        : null;
    // The creator's own committed quantity (default 1 unit).
    const quantity = normalizeQuantity(body?.quantity);
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
      .insert({ ...insertBase, city, shipping_estimate_usd: shippingEstimateUsd, target_quantity: targetQuantity, bulk_note: bulkNote })
      .select(POOL_SELECT_WITH_V3)
      .single();
    if (error && isMissingColumn(error)) {
      // 033 columns missing on create: retry without them.
      logger.error('[pools] v3 columns missing on create, retrying without them', { error: error instanceof Error ? error.message : error });
      ({ data: pool, error } = await supabase
        .from('pools')
        .insert({ ...insertBase, city, shipping_estimate_usd: shippingEstimateUsd })
        .select(POOL_SELECT_WITH_V2)
        .single());
    }
    if (error && isMissingColumn(error)) {
      // 018 migration not run yet: create the pool without the v2
      // columns. The pool still works; city/shipping stay unknown.
      logger.error('[pools] v2 columns missing on create, retrying without them', { error: error instanceof Error ? error.message : error });
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
    // Record the creator's quantity (best effort — missing 033 table
    // just means the creator counts as 1 unit, today's behaviour).
    await supabase
      .from('pool_member_quantities')
      .upsert({ pool_id: pool.id, user_id: auth.userId, quantity }, { onConflict: 'pool_id,user_id' });
    const created = normalizePool(pool as Record<string, unknown>);
    return apiSuccess(
      {
        ...created,
        memberCount: 1,
        totalQuantity: quantity,
        quantityProgress: poolQuantityProgressText(
          1,
          [quantity],
          typeof (pool as Record<string, unknown>).threshold === 'number'
            ? ((pool as Record<string, unknown>).threshold as number)
            : 0,
          typeof created.targetQuantity === 'number' ? created.targetQuantity : null
        ),
      },
      201
    );
  } catch (err) {
    logApiError(err, { request, route: 'pools.post', status: 500 });
    return internalError('Failed to create pool');
  }
}
