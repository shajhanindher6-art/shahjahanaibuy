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
import { isStripeLiveModeBlocked } from '@/lib/stripe';
import { logger } from '@/lib/config/logger';
import { createCheckoutSession, isStripeConfigured, type PlanKey } from '@/services/stripe';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'subscriptions.checkout' });
  // Rate limit: 10 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`subscriptions.checkout:${getClientIp(request)}`, 10);
  if (limited) return limited;

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
    const body = await request.json();
    const { plan } = body ?? {};

    if (!plan || !['pro'].includes(plan)) {
      return badRequest('Invalid plan. Available: pro');
    }

    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return badRequest('User email not found');

    const result = await createCheckoutSession(
      auth.userId,
      user.email,
      plan as PlanKey
    );

    if ('error' in result) {
      return internalError(result.error);
    }

    return apiSuccess({ url: result.url });
  } catch {
    return internalError('Failed to create checkout session');
  }
}
