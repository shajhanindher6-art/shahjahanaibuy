/**
 * Stripe Webhook handler.
 * POST /api/webhooks/stripe — receives Stripe webhook events.
 * This route is PUBLIC (no auth) but verifies the Stripe signature.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { getStripe } from '@/lib/stripe';
import { env } from '@/lib/config/env';
import { processWebhookEvent } from '@/services/stripe';
import { logger } from '@/lib/config/logger';

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return badRequest('Stripe is not configured');
  }

  const webhookSecret = env.stripeWebhookSecret;
  if (!webhookSecret) {
    return badRequest('Stripe webhook secret is not configured');
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return badRequest('Missing Stripe signature header');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', { error: String(err) });
    return badRequest('Invalid signature');
  }

  try {
    const supabase = await createSupabaseServerClient();
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
