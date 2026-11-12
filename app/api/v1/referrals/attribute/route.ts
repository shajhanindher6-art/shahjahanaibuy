/**
 * Referral signup attribution endpoint (Section 15, B13).
 * POST /api/v1/referrals/attribute — attribute the signed-in
 * user's signup to the owner of a referral code.
 *
 * Body: { code: "sb-…" }. The caller must be signed in (the
 * sign-up page calls this right after a session exists; the auth
 * callback page calls it after an email-confirmation sign-in).
 *
 * Invalid or unknown codes are ignored SILENTLY: the response is
 * still 200 with { attributed: false } — an unknown code is never
 * an error, so a bad link can never break signup. When migration
 * 038 has not been applied yet the answer is also
 * { attributed: false, reason: 'not-available' } and the signup
 * proceeds unattributed. Attribution is idempotent: a second call
 * for the same user returns 'already-attributed' and writes
 * nothing.
 *
 * Writes go through the service-role client only (there is no
 * INSERT policy on referral_signups by design).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, internalError } from '@/lib/api/responses';
import {
  logApiRequest,
  rateLimitResponse,
  getClientIp,
  requireAuth,
} from '@/lib/api/middleware';
import { isValidReferralCode } from '@/lib/referral';
import { attributeReferralSignup } from '@/services/referral-attribution';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'referrals.attribute' });

  const limited = await rateLimitResponse(
    `referrals-attribute:${getClientIp(request)}`,
    30,
    60_000
  );
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const rawCode =
    body && typeof body.code === 'string' ? body.code.trim().toLowerCase() : null;

  // Invalid format: ignored silently, never an error.
  if (!isValidReferralCode(rawCode)) {
    return apiSuccess({ attributed: false, reason: 'invalid-code' });
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return apiSuccess({ attributed: false, reason: 'not-available' });
  }

  try {
    const result = await attributeReferralSignup(service, auth.userId, rawCode);
    return apiSuccess(result);
  } catch {
    return internalError('Failed to record referral attribution');
  }
}
