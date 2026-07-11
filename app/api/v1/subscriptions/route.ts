/**
 * API v1 subscriptions endpoint.
 * GET  /api/v1/subscriptions — fetch the authenticated user's subscription.
 * POST /api/v1/subscriptions — create or update the user's subscription.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'subscriptions' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (error) {
      return internalError('Failed to fetch subscription');
    }

    return apiSuccess(data);
  } catch {
    return internalError('Failed to fetch subscription');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'subscriptions.upsert' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const {
      plan,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId,
      currentPeriodStart,
      currentPeriodEnd,
    } = body ?? {};

    if (typeof plan !== 'string' || plan.trim() === '') {
      return badRequest('plan is required');
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('subscriptions')
      .upsert({
        user_id: auth.userId,
        plan,
        stripe_customer_id: typeof stripeCustomerId === 'string' ? stripeCustomerId : null,
        stripe_subscription_id:
          typeof stripeSubscriptionId === 'string' ? stripeSubscriptionId : null,
        stripe_price_id: typeof stripePriceId === 'string' ? stripePriceId : null,
        current_period_start:
          typeof currentPeriodStart === 'string' ? currentPeriodStart : null,
        current_period_end:
          typeof currentPeriodEnd === 'string' ? currentPeriodEnd : null,
      })
      .select('*')
      .maybeSingle();

    if (error || !data) {
      return internalError('Failed to update subscription');
    }

    return apiSuccess(data);
  } catch {
    return internalError('Failed to update subscription');
  }
}
