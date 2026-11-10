/**
 * API v1 creator rewards — award.
 * POST /api/v1/creator-rewards/award — admin-only: award points for
 * one verified community deal. Body: { dealId: string }.
 *
 * VERIFICATION IS RE-CHECKED SERVER-SIDE: the deal must be verified
 * via admin flag OR the merchant-price match (services/community-deals
 * `isDealVerified`). Upvotes are never read here — a popular but
 * unverified deal earns 0 and the route answers 422. One award per
 * deal: creator_reward_events has UNIQUE (deal_id), so a repeat
 * award for the same deal answers 409.
 *
 * Fail-safe: if migration 031 (or the community-deals tables) has
 * not been run yet, answers 503 with an honest message.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, internalError, serviceUnavailable, validationError, conflict } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAdmin, getClientIp } from '@/lib/api/middleware';
import { isDealVerified, type MerchantPriceRow } from '@/services/community-deals';
import {
  POINTS_PER_VERIFIED_DEAL,
  badgeForVerifiedDeals,
} from '@/lib/creator-rewards';

export const dynamic = 'force-dynamic';

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'creator-rewards.award' });

  const limited = await rateLimitResponse(`creator-rewards.award:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const admin = await requireAdmin(request);
  if ('error' in admin) return admin.error;

  const body = await request.json().catch(() => null);
  const dealId = typeof body?.dealId === 'string' ? body.dealId.trim() : '';
  if (!dealId) return validationError('dealId is required');

  const service = createSupabaseServiceClient();
  if (!service) return serviceUnavailable('Rewards service is not configured.');

  try {
    const { data: deal, error: dealError } = await service
      .from('community_deals')
      .select('id, user_id, author_name, product_id, merchant_id, price, is_verified')
      .eq('id', dealId)
      .maybeSingle();
    if (dealError) {
      if (isMissingTable(dealError)) {
        return serviceUnavailable('Creator rewards are not set up yet — the owner still needs to run migration 031 once.');
      }
      console.error('[creator-rewards.award] deal fetch error', dealError);
      return internalError('Failed to award points');
    }
    if (!deal) return validationError('Deal not found');
    const d = deal as {
      id: string;
      user_id: string | null;
      author_name: string | null;
      product_id: string | null;
      merchant_id: string | null;
      price: number | null;
      is_verified: boolean;
    };
    if (!d.user_id) return validationError('Deal has no submitting user to reward');

    let merchantPrices: MerchantPriceRow[] = [];
    if (d.product_id && d.merchant_id) {
      const { data: mp } = await service
        .from('merchant_products')
        .select('merchant_id, product_id, price')
        .eq('product_id', d.product_id)
        .eq('merchant_id', d.merchant_id);
      merchantPrices = ((mp ?? []) as Array<{ merchant_id: string; product_id: string; price: number }>).map(
        (r) => ({ merchant_id: r.merchant_id, product_id: r.product_id, price: Number(r.price) })
      );
    }
    if (!isDealVerified(d, merchantPrices)) {
      return validationError(
        'Deal is not verified — rewards are only for deals verified by an admin or by a merchant-price match within 5%. Upvotes never verify a deal.'
      );
    }

    // One award per deal (UNIQUE deal_id). A repeat award is a 409.
    const { error: eventError } = await service.from('creator_reward_events').insert({
      user_id: d.user_id,
      deal_id: d.id,
      points: POINTS_PER_VERIFIED_DEAL,
      reason: 'verified_deal',
    });
    if (eventError) {
      if ((eventError as { code?: string }).code === '23505') {
        return conflict('This deal has already been awarded points.');
      }
      if (isMissingTable(eventError)) {
        return serviceUnavailable('Creator rewards are not set up yet — the owner still needs to run migration 031 once.');
      }
      console.error('[creator-rewards.award] event insert error', eventError);
      return internalError('Failed to award points');
    }

    const { data: existing } = await service
      .from('creator_rewards')
      .select('points, verified_deals')
      .eq('user_id', d.user_id)
      .maybeSingle();
    const prev = (existing as { points?: number; verified_deals?: number } | null) ?? null;
    const points = (prev?.points ?? 0) + POINTS_PER_VERIFIED_DEAL;
    const verifiedDeals = (prev?.verified_deals ?? 0) + 1;
    const { error: upsertError } = await service.from('creator_rewards').upsert({
      user_id: d.user_id,
      display_name: d.author_name ?? null,
      points,
      verified_deals: verifiedDeals,
      badge: badgeForVerifiedDeals(verifiedDeals),
      updated_at: new Date().toISOString(),
    });
    if (upsertError) {
      console.error('[creator-rewards.award] upsert error', upsertError);
      return internalError('Points were recorded but the leaderboard row could not be updated');
    }

    return apiSuccess(
      { userId: d.user_id, dealId: d.id, pointsAwarded: POINTS_PER_VERIFIED_DEAL, totalPoints: points, verifiedDeals, badge: badgeForVerifiedDeals(verifiedDeals) },
      201
    );
  } catch {
    return internalError('Failed to award points');
  }
}
