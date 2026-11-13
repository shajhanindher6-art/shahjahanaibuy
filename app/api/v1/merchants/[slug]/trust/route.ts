/**
 * API v1 merchant trust-score endpoint (Section 3 #14).
 * GET /api/v1/merchants/[slug]/trust — deterministic trust grade from
 * RECORDED policy data only (return window / warranty / reputation).
 *
 * No policy values are ever invented: when any input is missing the
 * grade is null and the response says "Not enough data", listing
 * exactly which facts are still missing. Today every merchant is in
 * that state — the migration adds the columns with NULL defaults and
 * no policy facts have been recorded.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getMerchantBySlug } from '@/services/commerce';
import {
  computeTrustGrade,
  getMerchantPolicy,
  TRUST_GRADE_INSUFFICIENT_LABEL,
} from '@/lib/merchant-trust';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'merchants.trust', slug: params.slug });

  const limited = await rateLimitResponse(`merchants-trust:${getClientIp(request)}`, 60);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const merchant = await getMerchantBySlug(supabase, params.slug);

    if (!merchant) {
      return notFound('Merchant not found');
    }

    const policy = await getMerchantPolicy(supabase, merchant.id);
    const result = computeTrustGrade(policy);

    return apiSuccess({
      merchant: { id: merchant.id, name: merchant.name, slug: merchant.slug },
      grade: result.grade,
      score: result.score,
      label: result.grade ? `Trust grade ${result.grade}` : TRUST_GRADE_INSUFFICIENT_LABEL,
      missing: result.missing,
      breakdown: result.breakdown,
      reasons: result.reasons,
      recorded: {
        returnWindowDays: policy.returnWindowDays,
        warrantyMonths: policy.warrantyMonths,
        reputationScore: policy.reputationScore,
        returnPolicyUrl: policy.returnPolicyUrl,
        warrantyPolicyUrl: policy.warrantyPolicyUrl,
        policyVerifiedAt: policy.policyVerifiedAt,
      },
      method:
        'Grade A (≥85) / B (≥70) / C (≥50) / D (<50) from recorded return window (0–40), warranty (0–30) and reputation (0–30). Any missing input means no grade is shown.',
    });
  } catch (err) {
    logApiError(err, { request, route: 'merchants.trust', status: 500 });
    return internalError('Failed to fetch merchant trust score');
  }
}
