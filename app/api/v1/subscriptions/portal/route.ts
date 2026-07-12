/**
 * Stripe Customer Portal endpoint.
 * POST /api/v1/subscriptions/portal — creates a Customer Portal session.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { createCustomerPortalSession, isStripeConfigured } from '@/services/stripe';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'subscriptions.portal' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  if (!isStripeConfigured()) {
    return badRequest('Stripe is not configured.');
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
