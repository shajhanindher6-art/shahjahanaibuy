/**
 * Stripe subscription service.
 * Handles Checkout Sessions, Customer Portal, webhook event processing,
 * and subscription lifecycle (create, upgrade, downgrade, cancel).
 */

import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { appConfig } from '@/lib/config/app';
import { logger } from '@/lib/config/logger';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import { sendSubscriptionEmail, sendInvoiceEmail } from '@/services/email';
// Section 15 P2-1/P2-2: price IDs and plan-key normalization live
// in the single pricing config — never hardcode a price ID or a
// dollar figure here.
import { PRICE_IDS, getTrialDays, isTrialOffered, normalizePlanKey } from '@/lib/pricing-config';

/**
 * Checkout plan config (Section 15 P2-2). Keys are TierIds now:
 * 'premium' is canonical. 'pro' is kept as a deprecated alias for
 * one release (same price ID as 'premium') so old clients keep
 * working; the webhook writes 'premium'. Price IDs come from
 * lib/pricing-config.ts (env, nullable) — an unset ID means that
 * tier cannot be bought.
 */
export const PLAN_CONFIG = {
  free: { name: 'Free', priceId: null },
  premium: { name: 'Premium', priceId: PRICE_IDS.premium },
  family: { name: 'Family', priceId: PRICE_IDS.family },
  team: { name: 'Team', priceId: PRICE_IDS.team },
  /** @deprecated Legacy key for 'premium'; kept for one release. */
  pro: { name: 'Premium', priceId: PRICE_IDS.premium },
} as const;

export type PlanKey = keyof typeof PLAN_CONFIG;

export async function createCheckoutSession(
  userId: string,
  userEmail: string,
  plan: PlanKey,
  successUrl?: string,
  cancelUrl?: string
): Promise<{ url: string } | { error: string }> {
  const stripe = getStripe();
  if (!stripe) return { error: 'Stripe is not configured' };

  const priceId = PLAN_CONFIG[plan].priceId;
  if (!priceId) return { error: 'Invalid plan or missing price ID' };

  try {
    // Section 15 P2-7: a free trial is only ever attached when the
    // owner configured trial days (STRIPE_TRIAL_DAYS > 0) AND the
    // live launch is approved. Default is 0 days = no trial, and no
    // trial is ever created in test mode.
    const trialDays = isTrialOffered() ? getTrialDays() : 0;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: userEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl ?? `${appConfig.url}/dashboard/billing?status=success`,
      cancel_url: cancelUrl ?? `${appConfig.url}/dashboard/billing?status=cancelled`,
      metadata: { userId, plan },
      subscription_data: {
        metadata: { userId, plan },
        ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
      },
    });

    return { url: session.url ?? '' };
  } catch (err) {
    logger.error('Stripe checkout session failed', { error: String(err) });
    return { error: 'Failed to create checkout session' };
  }
}

export async function createCustomerPortalSession(
  customerId: string,
  returnUrl?: string
): Promise<{ url: string } | { error: string }> {
  const stripe = getStripe();
  if (!stripe) return { error: 'Stripe is not configured' };

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl ?? `${appConfig.url}/dashboard/billing`,
    });

    return { url: session.url };
  } catch (err) {
    logger.error('Stripe customer portal failed', { error: String(err) });
    return { error: 'Failed to create portal session' };
  }
}

export async function syncSubscriptionFromStripe(
  supabase: AnySupabaseClient,
  stripeSubscriptionId: string
): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;

  try {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const userId = sub.metadata.userId;
    if (!userId) return;

    // Section 15 P2-2: the webhook writes canonical TierIds.
    // Legacy 'pro' metadata (old checkout sessions) maps to
    // 'premium'; unknown values fail closed to 'premium' here only
    // because Stripe has already accepted payment for this
    // subscription — the tier itself is resolved from the row by
    // lib/api-quota.ts, which fails closed to free.
    const plan = normalizePlanKey(sub.metadata.plan, 'premium');
    const currentPeriodStart = new Date(sub.current_period_start * 1000).toISOString();
    const currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
    const canceledAt = sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null;
    const endedAt = sub.ended_at ? new Date(sub.ended_at * 1000).toISOString() : null;
    const trialStart = sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null;
    const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

    await supabase.from('subscriptions').upsert({
      user_id: userId,
      plan,
      status: sub.status,
      stripe_customer_id: sub.customer as string,
      stripe_subscription_id: sub.id,
      stripe_price_id: sub.items.data[0]?.price?.id ?? null,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: sub.cancel_at_period_end,
      canceled_at: canceledAt,
      ended_at: endedAt,
      trial_start: trialStart,
      trial_end: trialEnd,
      quantity: sub.items.data[0]?.quantity ?? 1,
    });
  } catch (err) {
    logger.error('syncSubscriptionFromStripe failed', { error: String(err) });
  }
}

export async function processWebhookEvent(
  supabase: AnySupabaseClient,
  event: { id: string; type: string; data: Record<string, unknown> }
): Promise<void> {
  // Idempotency check
  const { data: existing } = await supabase
    .from('webhook_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle();

  if (existing) {
    logger.info('Webhook event already processed', { eventId: event.id, type: event.type });
    return;
  }

  // Record the event. A failed write must THROW (the route turns
  // it into a 500 so Stripe retries) — silently dropping the event
  // while returning 200 used to lose paid subscriptions with no
  // trace (Section 15 webhook-RLS investigation).
  const { error: recordError } = await supabase.from('webhook_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event.data as Record<string, unknown>,
  });
  if (recordError) {
    throw new Error(`Failed to record webhook event ${event.id}: ${recordError.message}`);
  }

  const stripe = getStripe();
  if (!stripe) return;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Record<string, unknown>;
      const subscriptionId = session.subscription as string;
      if (subscriptionId) {
        await syncSubscriptionFromStripe(supabase, subscriptionId);
        const customerEmail = session.customer_email as string;
        const metadata = session.metadata as Record<string, string> | undefined;
        // Section 15 P2-2: normalize the legacy 'pro' key so the
        // email copy uses the canonical tier name.
        const plan = normalizePlanKey(metadata?.plan, 'premium');
        if (customerEmail && metadata?.plan) {
          // Section 15, P4-5 — no fire-and-forget: a failed
          // subscription email used to vanish silently (`void`
          // send). Check the result and log it instead.
          const emailResult = await sendSubscriptionEmail(customerEmail, plan, 'active');
          if (!emailResult.success) {
            logger.warn('Subscription email failed', {
              email: customerEmail,
              plan,
              error: emailResult.error,
            });
          }
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Record<string, unknown>;
      const subId = sub.id as string;
      if (subId) await syncSubscriptionFromStripe(supabase, subId);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Record<string, unknown>;
      const subId = sub.id as string;
      if (subId) await syncSubscriptionFromStripe(supabase, subId);

      const userId = (sub.metadata as Record<string, string> | undefined)?.userId;
      if (userId) {
        await supabase.from('subscriptions').update({ plan: 'free', status: 'canceled' }).eq('user_id', userId);
      }
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Record<string, unknown>;
      const customerId = invoice.customer as string;
      const amountPaid = invoice.amount_paid as number;
      const currency = invoice.currency as string;
      const invoiceUrl = invoice.hosted_invoice_url as string;
      const invoiceId = invoice.id as string;
      const invoicePdf = invoice.invoice_pdf as string | null;
      const invoiceCharge = invoice.charge as string | null;
      const invoiceStatus = invoice.status as string;
      const periodStart = invoice.period_start as number | null;
      const periodEnd = invoice.period_end as number | null;
      const customerIdStr = typeof customerId === 'string' ? customerId : '';

      // Find user by stripe_customer_id
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_customer_id', customerIdStr)
        .maybeSingle();

      if (sub?.user_id) {
        await supabase.from('billing_history').insert({
          user_id: sub.user_id,
          stripe_invoice_id: invoiceId,
          stripe_charge_id: invoiceCharge,
          amount_paid: amountPaid,
          currency,
          status: invoiceStatus,
          invoice_url: invoiceUrl,
          invoice_pdf: invoicePdf,
          period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
          period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        });

        // Get user email for invoice notification
        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', sub.user_id)
          .maybeSingle();

        if (profile?.email && invoiceUrl) {
          // Section 15, P4-5 — no fire-and-forget: check the
          // result and log a failed invoice email instead of
          // assuming it was sent.
          const emailResult = await sendInvoiceEmail(profile.email, amountPaid, currency, invoiceUrl);
          if (!emailResult.success) {
            logger.warn('Invoice email failed', {
              email: profile.email,
              invoiceId,
              error: emailResult.error,
            });
          }
        }
      }
      break;
    }

    default:
      logger.info('Unhandled webhook event type', { type: event.type });
  }
}

export async function getBillingHistory(
  supabase: AnySupabaseClient,
  userId: string
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase
    .from('billing_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];
  return data as Array<Record<string, unknown>>;
}

export { isStripeConfigured };
