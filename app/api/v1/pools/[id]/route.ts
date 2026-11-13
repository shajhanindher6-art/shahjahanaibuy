/**
 * API v1 SmartPool detail endpoint (Section 6, Item 8).
 * GET /api/v1/pools/[id] — one pool with real member counts and real
 * committed quantities: "N of M members · Q of T units committed".
 *
 * Quantities come from pool_member_quantities (migration 033); a
 * member without a quantity row counts as 1 unit. The shipping split
 * is quantity-aware (see services/smartpool.ts) and is an estimate
 * only — never a carrier quote, never a discount promise.
 *
 * Graceful degradation: missing pools table → { poolsEnabled: false }
 * empty state; missing 033 columns/table → quantities default to 1
 * per member and target/bulk-note degrade to null.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, notFound } from '@/lib/api/responses';
import { logger } from '@/lib/config/logger';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { normalizeQuantity, poolQuantityProgress, poolQuantityProgressText } from '@/lib/pool-quantities';
import { splitShippingEstimate, POOL_NO_GUARANTEE_NOTE } from '@/services/smartpool';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703';
}

const POOL_SELECT_WITH_V3 =
  'id, product_id, product_name, region_code, city, shipping_estimate_usd, target_quantity, bulk_note, threshold, creator_id, status, created_at';
const POOL_SELECT_WITH_V2 =
  'id, product_id, product_name, region_code, city, shipping_estimate_usd, threshold, creator_id, status, created_at';
const POOL_SELECT_BASE =
  'id, product_id, product_name, region_code, threshold, creator_id, status, created_at';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'pools.id', id: params.id });
  const limited = await rateLimitResponse(`pools.id:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const runQuery = async (select: string) =>
      supabase.from('pools').select(select).eq('id', params.id).maybeSingle();
    let { data: pool, error } = await runQuery(POOL_SELECT_WITH_V3);
    if (error && isMissingColumn(error)) {
      ({ data: pool, error } = await runQuery(POOL_SELECT_WITH_V2));
    }
    if (error && isMissingColumn(error)) {
      ({ data: pool, error } = await runQuery(POOL_SELECT_BASE));
    }
    if (error) {
      logger.error('[pools.id] fetch error', { error: error instanceof Error ? error.message : error });
      if (isMissingTable(error)) return apiSuccess(null, 200, { poolsEnabled: false });
      return internalError('Failed to fetch pool');
    }
    if (!pool) return notFound('Pool not found');

    const row = pool as unknown as Record<string, unknown>;
    const threshold = typeof row.threshold === 'number' ? row.threshold : 0;
    const targetQuantity =
      typeof row.target_quantity === 'number' && row.target_quantity >= 2
        ? row.target_quantity
        : null;
    const shippingEstimateUsd =
      typeof row.shipping_estimate_usd === 'number' ? row.shipping_estimate_usd : null;

    const { data: members } = await supabase
      .from('pool_members')
      .select('user_id')
      .eq('pool_id', params.id);
    const memberIds = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
    const memberCount = memberIds.length;

    // Per-member quantities; a member without a row counts as 1.
    const quantityByUser = new Map<string, number>();
    const { data: quantityRows, error: quantitiesError } = await supabase
      .from('pool_member_quantities')
      .select('user_id, quantity')
      .eq('pool_id', params.id);
    if (!quantitiesError) {
      for (const q of (quantityRows ?? []) as Array<{ user_id: string; quantity: number }>) {
        quantityByUser.set(q.user_id, normalizeQuantity(q.quantity));
      }
    }
    const memberQuantities = memberIds.map((id) => quantityByUser.get(id) ?? 1);
    const progress = poolQuantityProgress(memberCount, memberQuantities, threshold, targetQuantity);
    const shippingSplit = splitShippingEstimate(shippingEstimateUsd, memberCount, memberQuantities);

    return apiSuccess(
      {
        id: row.id,
        productId: row.product_id,
        productName: row.product_name,
        regionCode: row.region_code,
        city: typeof row.city === 'string' && row.city ? row.city : null,
        shippingEstimateUsd,
        targetQuantity,
        bulkNote: typeof row.bulk_note === 'string' && row.bulk_note ? row.bulk_note : null,
        threshold,
        creatorId: row.creator_id,
        status: row.status,
        createdAt: row.created_at,
        memberCount,
        totalQuantity: progress.totalQuantity,
        quantityProgress: poolQuantityProgressText(memberCount, memberQuantities, threshold, targetQuantity),
        quantityPercent: progress.quantityPercent,
        quantityReached: progress.quantityReached,
        quantities: memberIds.map((userId, i) => ({ userId, quantity: memberQuantities[i] })),
        shippingSplit,
        noGuaranteeNote: POOL_NO_GUARANTEE_NOTE,
      },
      200,
      { poolsEnabled: true }
    );
  } catch (err) {
    logApiError(err, { request, route: 'pools', status: 500 });
    logger.error('[pools.id] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to fetch pool');
  }
}
