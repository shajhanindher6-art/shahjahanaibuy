/**
 * API v1 verified merchants endpoint (Section 5 #15).
 * GET /api/v1/merchants/verified — the public Verified Merchant
 * program: standards, meaning, removal policy, and the merchants
 * currently carrying the badge.
 *
 * Today the list is empty: no merchant has recorded data meeting all
 * five public standards, and no badge is ever granted without that
 * evidence. The empty list is the honest state, stated as such.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  getVerifiedMerchants,
  VERIFIED_MERCHANT_MEANING,
  VERIFIED_MERCHANT_REMOVAL_POLICY,
  VERIFIED_MERCHANT_STANDARDS,
  VERIFIED_MERCHANT_RECHECK_DAYS,
} from '@/lib/verified-merchants';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'merchants.verified' });

  const limited = await rateLimitResponse(`merchants-verified:${getClientIp(request)}`, 60);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const merchants = await getVerifiedMerchants(supabase);

    return apiSuccess({
      merchants,
      standards: VERIFIED_MERCHANT_STANDARDS,
      meaning: VERIFIED_MERCHANT_MEANING,
      removalPolicy: VERIFIED_MERCHANT_REMOVAL_POLICY,
      recheckDays: VERIFIED_MERCHANT_RECHECK_DAYS,
      note:
        merchants.length === 0
          ? 'No verified merchants yet — no merchant has recorded data meeting all five standards. The badge is earned by evidence, never granted by default.'
          : `${merchants.length} verified merchant${merchants.length === 1 ? '' : 's'}.`,
    });
  } catch {
    return internalError('Failed to fetch verified merchants');
  }
}
