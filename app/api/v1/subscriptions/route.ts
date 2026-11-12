/**
 * API v1 subscriptions endpoint.
 * GET  /api/v1/subscriptions — fetch the authenticated user's subscription.
 * POST /api/v1/subscriptions — create or update the user's subscription.
 *   Direct upserts may ONLY ever set plan 'free' (P2-4, Section 15):
 *   paid plans are granted exclusively by the Stripe webhook after a
 *   real checkout — never by a client-supplied plan value.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { isStripeConfigured } from '@/services/stripe';
import { isStripeLiveLaunchApproved, isStripeLiveMode } from '@/lib/stripe';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'subscriptions' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`subscriptions:${getClientIp(request)}`, 120);
  if (limited) return limited;

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

    // Section 15 P2-5: the billing page banner derives from this
    // meta, never from a hardcoded claim. paymentsLive is true only
    // when a live key AND the owner's explicit
    // STRIPE_LIVE_LAUNCHED=true are both present (same derivation
    // as /pricing). stripeConfigured is the same flag the POST
    // branch already reads.
    return apiSuccess(data, 200, {
      paymentsLive: isStripeLiveMode() && isStripeLiveLaunchApproved(),
      stripeConfigured: isStripeConfigured(),
    });
  } catch {
    return internalError('Failed to fetch subscription');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'subscriptions.upsert' });
  // Rate limit: 10 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`subscriptions:${getClientIp(request)}`, 10);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { plan, cancelAtPeriodEnd } = body ?? {};

    if (typeof plan !== 'string' || plan.trim() === '') {
      return badRequest('plan is required');
    }

    const supabase = await createSupabaseServerClient();

    // P2-4 (Section 15): close the subscriptions self-grant bypass.
    // A direct upsert may ONLY ever set plan 'free'. Paid plans are
    // granted exclusively by the Stripe webhook
    // (services/stripe.ts syncSubscriptionFromStripe) after a real
    // checkout — never by a client-supplied plan value. Previously
    // any authenticated user could upsert plan 'team' + status
    // 'active' whenever Stripe was unconfigured and receive the
    // 100,000/day Team quota (lib/api-quota.ts trusts the row).
    if (plan !== 'free') {
      if (isStripeConfigured()) {
        return badRequest('Use /api/v1/subscriptions/checkout to upgrade plans');
      }
      return badRequest('Paid plans are only available through Stripe checkout');
    }

    // Without Stripe, or for cancel-to-free, allow direct upsert
    // (plan is 'free' from here on — see the whitelist above).
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
