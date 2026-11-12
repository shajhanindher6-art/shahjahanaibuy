/**
 * Stripe Checkout Session endpoint.
 * POST /api/v1/subscriptions/checkout — creates a Stripe Checkout Session.
 *
 * S2#11 live-mode guard: a live secret key alone never enables real
 * charges. While STRIPE_LIVE_LAUNCHED is not explicitly 'true',
 * isStripeLiveModeBlocked() refuses checkout with 503 + a loud log.
 * Test mode works unchanged.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { checkCsrfOrigin } from '@/lib/api/csrf';
import { validateBody } from '@/lib/api/validation';
import { z } from 'zod';
import { logApiError } from '@/lib/api/error-logging';
import { isStripeLiveModeBlocked } from '@/lib/stripe';
import { logger } from '@/lib/config/logger';
import { normalizePlanKey } from '@/lib/pricing-config';
import { createCheckoutSession, isStripeConfigured, type PlanKey } from '@/services/stripe';

/**
 * Section 18, Phase 2, item 10 (audit §1 #13) — checkout body
 * validated with the shared `validateBody` helper (Zod), matching
 * the subscriptions upsert route. Canonical plan keys are TierIds
 * ('premium', 'family', 'team'); 'pro' stays accepted as the
 * deprecated alias for 'premium' (see below). A missing, unknown,
 * or non-string plan is a 400, as before.
 */
const checkoutSchema = z.object({
  plan: z.enum(['premium', 'family', 'team', 'pro']),
});

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'subscriptions.checkout' });
  // Rate limit: 10 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`subscriptions.checkout:${getClientIp(request)}`, 10);
  if (limited) return limited;

  // Section 18, Phase 2, item 8 — CSRF Origin check (cookie-authed
  // mutation; absent Origin fails open for non-browser clients).
  const csrf = checkCsrfOrigin(request);
  if (csrf) return csrf;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  if (!isStripeConfigured()) {
    return badRequest('Stripe is not configured. Add STRIPE_SECRET_KEY to enable payments.');
  }

  // S2#11 live-mode guard: refuse real charges until the owner
  // deliberately launches live mode (STRIPE_LIVE_LAUNCHED=true).
  // Test mode is never blocked. Loud log so a misconfigured live
  // key is impossible to miss in Vercel Runtime Logs.
  if (isStripeLiveModeBlocked()) {
    logger.error('STRIPE LIVE MODE BLOCKED: live key set without a deliberate launch approval', {
      endpoint: 'subscriptions.checkout',
    });
    return serviceUnavailable(
      'Live payments are not launched yet. Stripe stays in test mode until the owner deliberately enables live mode.'
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const validation = validateBody(checkoutSchema, body ?? {});
    if (!validation.success) {
      const firstError = Object.values(validation.errors).flat()[0];
      return badRequest(firstError ?? 'Invalid request body');
    }
    const { plan } = validation.data;

    // Section 15 P2-2: canonical plan keys are TierIds ('premium',
    // 'family', 'team'). 'pro' is accepted as a deprecated alias
    // for 'premium' for one release. A tier whose Stripe price ID
    // is not configured fails honestly inside
    // createCheckoutSession ('Invalid plan or missing price ID').
    const normalizedPlan = normalizePlanKey(plan, 'premium');

    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return badRequest('User email not found');

    const result = await createCheckoutSession(
      auth.userId,
      user.email,
      normalizedPlan as PlanKey
    );

    if ('error' in result) {
      // Section 18, Phase 2 — item 55 (audit §1 #75): the Stripe
      // service error is logged server-side only; the client gets
      // the generic envelope, never a backend message.
      logApiError(new Error(result.error), {
        request,
        route: 'subscriptions.checkout',
        status: 500,
      });
      return internalError('Failed to create checkout session');
    }

    return apiSuccess({ url: result.url });
  } catch {
    return internalError('Failed to create checkout session');
  }
}
