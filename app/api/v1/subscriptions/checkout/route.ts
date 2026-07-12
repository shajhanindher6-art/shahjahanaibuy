/**
 * Stripe Checkout Session endpoint.
 * POST /api/v1/subscriptions/checkout — creates a Stripe Checkout Session.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { createCheckoutSession, isStripeConfigured, type PlanKey } from '@/services/stripe';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'subscriptions.checkout' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  if (!isStripeConfigured()) {
    return badRequest('Stripe is not configured. Add STRIPE_SECRET_KEY to enable payments.');
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
