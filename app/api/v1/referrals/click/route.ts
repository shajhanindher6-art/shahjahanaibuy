/**
 * Referral click tracking (S3#10).
 * POST /api/v1/referrals/click — record one click on a referral link.
 *
 * Same shape as the affiliate-clicks infra (one row per click + a
 * counter on the link) but in the dedicated referral_clicks table —
 * no IP address or user agent is ever stored (migration 026).
 * The service-role client is used because the anon role has no
 * SELECT policy on referral_links (by design); the lookup is scoped
 * to the single code in the request body.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import {
  logApiRequest,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { isValidReferralCode } from '@/lib/referral';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'referrals.click' });

  const limited = await rateLimitResponse(
    `referrals-click:${getClientIp(request)}`,
    60,
    60_000
  );
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const { code, productId } = body ?? {};

    if (!isValidReferralCode(code)) {
      return badRequest('A valid referral code is required');
    }

    const service = createSupabaseServiceClient();
    if (!service) return internalError('Referral tracking unavailable');

    const { data: link } = await service
      .from('referral_links')
      .select('id, click_count')
      .eq('code', code)
      .maybeSingle();
    if (!link) return badRequest('Unknown referral code');
    const linkRow = link as { id: string; click_count: number };

    const { error: insertError } = await service
      .from('referral_clicks')
      .insert({
        referral_link_id: linkRow.id,
        product_id:
          typeof productId === 'string' && productId.trim() !== ''
            ? productId
            : null,
      });
    if (insertError) return internalError('Failed to track referral click');

    // Best-effort counter bump (the clicks table is the source of
    // truth; a failed bump never fails the tracked click).
    await service
      .from('referral_links')
      .update({ click_count: (linkRow.click_count ?? 0) + 1 })
      .eq('id', linkRow.id);

    return apiSuccess({ tracked: true });
  } catch {
    return internalError('Failed to track referral click');
  }
}
