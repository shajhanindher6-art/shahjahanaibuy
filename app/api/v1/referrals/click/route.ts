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
import {
  REFERRAL_CLICK_DEDUPE_WINDOW_MS,
  hasReferralClickCookie,
  isDuplicateReferralClick,
  recordReferralClickDedupe,
  referralClickCookieName,
} from '@/lib/referral-dedupe';

import { logApiError } from '@/lib/api/error-logging';
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

    // Section 18, Phase 2 — item 12 (audit §1 #59): dedupe.
    // A repeat click from the same browser (cookie for this
    // code) or the same code+IP inside the window does not
    // increment again. The route stays public and the 60/min/IP
    // limit above is unchanged.
    const cookieName = referralClickCookieName(code);
    const hasCookie = hasReferralClickCookie(
      request.cookies.get(cookieName)?.value
    );
    if (isDuplicateReferralClick(code, getClientIp(request), hasCookie)) {
      return apiSuccess({ tracked: false });
    }

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

    recordReferralClickDedupe(code, getClientIp(request));
    const response = apiSuccess({ tracked: true });
    response.cookies.set(cookieName, '1', {
      maxAge: REFERRAL_CLICK_DEDUPE_WINDOW_MS / 1000,
      path: '/',
      sameSite: 'lax',
    });
    return response;
  } catch (err) {
    logApiError(err, { request, route: 'referrals.click', status: 500 });
    return internalError('Failed to track referral click');
  }
}
