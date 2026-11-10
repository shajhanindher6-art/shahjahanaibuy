/**
 * Stripe Customer Portal endpoint.
 * POST /api/v1/subscriptions/portal — creates a Customer Portal session.
 *
 * S2#11 live-mode guard: same rule as checkout — a live secret key
 * alone never enables live billing. While STRIPE_LIVE_LAUNCHED is
 * not explicitly 'true', the portal refuses with 503 + a loud log.
 * Test mode works unchanged.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { isStripeLiveModeBlocked } from '@/lib/stripe';
import { logger } from '@/lib/config/logger';
import { createCustomerPortalSession, isStripeConfigured } from '@/services/stripe';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'subscriptions.portal' });
  // Rate limit: 10 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`subscriptions.portal:${getClientIp(request)}`, 10);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  if (!isStripeConfigured()) {
    return badRequest('Stripe is not configured.');
  }

  // S2#11 live-mode guard: refuse live billing until the owner
  // deliberately launches live mode (STRIPE_LIVE_LAUNCHED=true).
  if (isStripeLiveModeBlocked()) {
    logger.error('STRIPE LIVE MODE BLOCKED: live key set without a deliberate launch approval', {
      endpoint: 'subscriptions.portal',
    });
    return serviceUnavailable(
      'Live payments are not launched yet. Stripe stays in test mode until the owner deliberately enables live mode.'
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (error || !data?.stripe_customer_id) {
      return badRequest('No active subscription found');
    }

    const result = await createCustomerPortalSession(data.stripe_customer_id);

    if ('error' in result) {
      return internalError(result.error);
    }

    return apiSuccess({ url: result.url });
  } catch {
    return internalError('Failed to create portal session');
  }
}
