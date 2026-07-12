/**
 * API v1 subscriptions endpoint.
 * GET  /api/v1/subscriptions — fetch the authenticated user's subscription.
 * POST /api/v1/subscriptions — create or update the user's subscription.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { isStripeConfigured } from '@/services/stripe';

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
    const { plan, cancelAtPeriodEnd } = body ?? {};

    if (typeof plan !== 'string' || plan.trim() === '') {
      return badRequest('plan is required');
    }

    const supabase = await createSupabaseServerClient();

    // If Stripe is configured, subscription changes must go through Stripe
    if (isStripeConfigured() && plan !== 'free') {
      return badRequest('Use /api/v1/subscriptions/checkout to upgrade plans');
    }

    // Without Stripe, or for cancel-to-free, allow direct upsert
    const existing = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', auth.userId)
      .maybeSingle();

    const updates: Record<string, unknown> = {
      user_id: auth.userId,
      plan,
      status: cancelAtPeriodEnd ? 'canceling' : (plan === 'free' ? 'canceled' : 'active'),
    };

    if (cancelAtPeriodEnd) {
      updates.cancel_at_period_end = true;
    } else if (plan === 'free') {
      updates.cancel_at_period_end = false;
      updates.ended_at = new Date().toISOString();
    }

    if (existing.data) {
      const { data, error } = await supabase
        .from('subscriptions')
        .update(updates)
        .eq('user_id', auth.userId)
        .select('*')
        .maybeSingle();

      if (error || !data) {
        return internalError('Failed to update subscription');
      }
      return apiSuccess(data);
    } else {
      const { data, error } = await supabase
        .from('subscriptions')
        .insert({
          ...updates,
          current_period_start: new Date().toISOString(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select('*')
        .maybeSingle();

      if (error || !data) {
        return internalError('Failed to create subscription');
      }
      return apiSuccess(data);
    }
  } catch {
    return internalError('Failed to update subscription');
  }
}
