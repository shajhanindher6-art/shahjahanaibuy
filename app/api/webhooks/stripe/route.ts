/**
 * Stripe Webhook handler.
 * POST /api/webhooks/stripe — receives Stripe webhook events.
 * This route is PUBLIC (no auth) but verifies the Stripe signature.
 *
 * Section 15 webhook-RLS investigation (VERIFIED BROKEN, fixed
 * here): this route used to build its Supabase client with
 * the anon-key server client — the ANON key with no session
 * cookies, i.e. the `anon` role. But every table the webhook
 * writes has RLS policies for `authenticated` ONLY:
 * - subscriptions (migration 009): SELECT/INSERT/UPDATE TO
 *   authenticated, USING/WITH CHECK (auth.uid() = user_id);
 * - webhook_events (migration 012): SELECT TO authenticated only;
 * - billing_history (migration 012): SELECT/INSERT TO
 *   authenticated only.
 * So every webhook write was RLS-denied: the idempotency insert,
 * the subscription upsert (syncSubscriptionFromStripe) and the
 * invoice insert all failed, while the route still returned 200
 * {received:true} because processWebhookEvent never checked the
 * write errors — paid subscriptions were silently lost. The fix
 * is the service-role client (bypasses RLS), the same pattern
 * /api/v1/alerts/check and /api/v1/prices/refresh already use for
 * server-side writes. No policy change was needed, so no new
 * migration was written. If SUPABASE_SERVICE_ROLE_KEY is unset
 * the route now fails honestly with 503 instead of a false 200.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, badRequest, internalError, serviceUnavailable } from '@/lib/api/responses';
import { getStripe } from '@/lib/stripe';
import { env } from '@/lib/config/env';
import { processWebhookEvent } from '@/services/stripe';
import { rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';

export async function POST(request: NextRequest) {
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`webhooks.stripe:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const stripe = getStripe();
  if (!stripe) {
    return badRequest('Stripe is not configured');
  }

  const webhookSecret = env.stripeWebhookSecret;
  if (!webhookSecret) {
    return badRequest('Stripe webhook secret is not configured');
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return badRequest('Missing Stripe signature header');
  }

  let event;
  try {
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', { error: String(err) });
    return badRequest('Invalid signature');
  }

  try {
    // Service-role client: the webhook carries no user session,
    // and the tables it writes (subscriptions, webhook_events,
    // billing_history) are RLS-restricted to `authenticated` —
    // an anon-key client can never write them (see header).
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      logger.error('Stripe webhook cannot write: SUPABASE_SERVICE_ROLE_KEY is not configured');
      return serviceUnavailable(
        'Webhook storage is not configured. The event was verified but not recorded.'
      );
    }
    await processWebhookEvent(supabase, {
      id: event.id,
      type: event.type,
      data: event.data.object as Record<string, unknown>,
    });

    return apiSuccess({ received: true });
  } catch (err) {
    logger.error('Stripe webhook processing failed', { error: String(err), eventType: event.type });
    return internalError('Webhook processing failed');
  }
}
