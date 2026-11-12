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

/**
 * Handle a failed invoice payment (Section 17, Stage G — code only,
 * TEST mode; no live activation, no dunning email yet).
 *
 * Dunning / retry decision: rely on Stripe's automatic retries
 * (Smart Retries) — do NOT cancel the subscription here and do NOT
 * downgrade the plan. The local row is marked `past_due`, which
 * suspends the paid quota (lib/api-quota.ts resolves `past_due` to
 * free) until a later `invoice.paid` or
 * `customer.subscription.updated` event restores `active` via
 * syncSubscriptionFromStripe. The failure is logged with its retry
 * context (attempt count, next attempt) and recorded as a
 * zero-amount `billing_history` row, mirroring the `invoice.paid`
 * audit trail — a failed payment moves no money, so `amount_paid`
 * is 0 and the status is `payment_failed`. No dunning email is
 * sent: the email templates cover paid invoices only, and inventing
 * a payment-failure template is out of scope for this stage.
 * Failures to mark past_due or to record history are logged, never
 * thrown — the webhook event itself is already recorded, and
 * throwing would make Stripe retry an event that was handled.
 */
export async function handleInvoicePaymentFailed(
  supabase: AnySupabaseClient,
  invoice: Record<string, unknown>
): Promise<void> {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : '';
  const invoiceId = typeof invoice.id === 'string' ? invoice.id : '';
  const subscriptionId =
    typeof invoice.subscription === 'string' ? invoice.subscription : '';
  const attemptCount =
    typeof invoice.attempt_count === 'number' ? invoice.attempt_count : null;
  const nextPaymentAttempt =
    typeof invoice.next_payment_attempt === 'number'
      ? new Date(invoice.next_payment_attempt * 1000).toISOString()
      : null;
  const amountDue = typeof invoice.amount_due === 'number' ? invoice.amount_due : null;
  const currency = typeof invoice.currency === 'string' ? invoice.currency : null;

  logger.warn('Stripe invoice payment failed', {
    invoiceId,
    customerId,
    subscriptionId,
    attemptCount,
    nextPaymentAttempt,
    amountDue,
    currency,
  });

  if (!customerId) {
    logger.warn('invoice.payment_failed without a customer id; nothing to mark past_due', {
      invoiceId,
    });
    return;
  }

  // Authoritative status first when a subscription id is present:
  // never trust the event payload alone (same rule as the other
  // webhook handlers). No-op when Stripe is unconfigured (tests).
  if (subscriptionId) {
    await syncSubscriptionFromStripe(supabase, subscriptionId);
  }

  // Find the local row by Stripe customer id (same lookup as
  // invoice.paid). No local row → nothing to mark, nothing to
  // attribute the history row to.
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (!sub?.user_id) {
    logger.warn('invoice.payment_failed for a customer with no local subscription row', {
      invoiceId,
      customerId,
    });
    return;
  }

  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('stripe_customer_id', customerId);
  if (updateError) {
    logger.warn('Failed to mark subscription past_due after payment failure', {
      invoiceId,
      customerId,
      error: updateError.message,
    });
  }

  const invoiceUrl =
    typeof invoice.hosted_invoice_url === 'string' ? invoice.hosted_invoice_url : null;
  const invoicePdf = typeof invoice.invoice_pdf === 'string' ? invoice.invoice_pdf : null;
  const invoiceCharge = typeof invoice.charge === 'string' ? invoice.charge : null;
  const periodStart =
    typeof invoice.period_start === 'number'
      ? new Date(invoice.period_start * 1000).toISOString()
      : null;
  const periodEnd =
    typeof invoice.period_end === 'number'
      ? new Date(invoice.period_end * 1000).toISOString()
      : null;

  const { error: historyError } = await supabase.from('billing_history').insert({
    user_id: sub.user_id,
    stripe_invoice_id: invoiceId,
    stripe_charge_id: invoiceCharge,
    amount_paid: 0,
    currency,
    status: 'payment_failed',
    invoice_url: invoiceUrl,
    invoice_pdf: invoicePdf,
    period_start: periodStart,
    period_end: periodEnd,
  });
  if (historyError) {
    logger.warn('Failed to record failed-payment billing history', {
      invoiceId,
      customerId,
      error: historyError.message,
    });
  }
}

/**
 * Record a webhook event's handler outcome (Section 18, item 46;
 * migration 049 adds the `status` + `error` columns).
 *
 * Best-effort by design: when 049 is unapplied the columns do not
 * exist and the update fails (42703) — that is logged and the
 * webhook itself is NOT failed over bookkeeping, otherwise a
 * successfully handled event would 500 and Stripe would retry an
 * event that was already handled. Never throws.
 */
async function updateWebhookEventOutcome(
  supabase: AnySupabaseClient,
  stripeEventId: string,
  status: 'processed' | 'failed',
  errorMessage?: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from('webhook_events')
      .update({ status, error: errorMessage ?? null })
      .eq('stripe_event_id', stripeEventId);
    if (error) {
      logger.warn('Failed to record webhook event outcome', {
        eventId: stripeEventId,
        status,
        error: error.message,
      });
    }
  } catch (err) {
    logger.warn('Failed to record webhook event outcome', {
      eventId: stripeEventId,
      status,
      error: String(err),
    });
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

  // Section 18, item 46 — reprocess-on-retry: a row whose status
  // is 'failed' means the handlers never completed, so a Stripe
  // retry must run them again instead of skipping. The status read
  // tolerates a missing column (migration 049 unapplied): any
  // error reading it keeps the old skip behaviour, so an unapplied
  // 049 changes nothing.
  let isFailedRetry = false;
  if (existing) {
    const { data: statusRow } = await supabase
      .from('webhook_events')
      .select('status')
      .eq('stripe_event_id', event.id)
      .maybeSingle();
    if ((statusRow as { status?: string } | null)?.status === 'failed') {
      logger.info('Webhook event previously failed; reprocessing', {
        eventId: event.id,
        type: event.type,
      });
      isFailedRetry = true;
    } else {
      logger.info('Webhook event already processed', { eventId: event.id, type: event.type });
      return;
    }
  }

  if (!isFailedRetry) {
    // Record the event. A failed write must THROW (the route turns
    // it into a 500 so Stripe retries) — silently dropping the event
    // while returning 200 used to lose paid subscriptions with no
    // trace (Section 15 webhook-RLS investigation).
    //
    // Section 18, item 21: a 23505 here is NOT a failure — it is a
    // concurrent double delivery: the select above found no row,
    // but the other delivery inserted the same stripe_event_id
    // first. Treat it as already-processed and return cleanly (no
    // throw, no 500, no Stripe retry storm): the other delivery
    // owns handling, and if it fails, its 'failed' outcome makes
    // the next Stripe retry reprocess the event instead of
    // skipping it (item 46).
    const { error: recordError } = await supabase.from('webhook_events').insert({
      stripe_event_id: event.id,
      event_type: event.type,
      payload: event.data as Record<string, unknown>,
    });
    if (recordError) {
      if ((recordError as { code?: string }).code === '23505') {
        logger.info('Webhook event already recorded by a concurrent delivery', {
          eventId: event.id,
          type: event.type,
        });
        return;
      }
      throw new Error(`Failed to record webhook event ${event.id}: ${recordError.message}`);
    }
  }

  const stripe = getStripe();
  if (!stripe) {
    // No Stripe client: the handlers cannot run. Record the
    // outcome so the row does not sit as 'pending' forever (the
    // route already rejects unconfigured Stripe before reaching
    // here; this is a defensive path for direct callers).
    await updateWebhookEventOutcome(supabase, event.id, 'failed', 'Stripe is not configured');
    return;
  }

  try {

  // Event-shape normalization (ONE place, all handlers below use
  // `payload`): the webhook route passes `event.data.object` as
  // `data`, so `data` IS the Stripe object and its `object` field
  // is just the type string ('checkout.session', 'subscription',
  // 'invoice') — reading `event.data.object` as the payload made
  // every handler silently no-op live (guarded undefined lookups).
  // A fabricated/full Stripe event may instead carry the object
  // under `data.object`; accept that shape too. A real Stripe
  // object's `object` field is always a string, never the payload,
  // so `typeof === 'object'` distinguishes the two shapes.
  const payload =
    typeof event.data?.object === 'object' && event.data.object !== null
      ? (event.data.object as Record<string, unknown>)
      : event.data;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = payload;
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
      const sub = payload;
      const subId = sub.id as string;
      if (subId) await syncSubscriptionFromStripe(supabase, subId);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = payload;
      const subId = sub.id as string;
      if (subId) await syncSubscriptionFromStripe(supabase, subId);

      const userId = (sub.metadata as Record<string, string> | undefined)?.userId;
      if (userId) {
        await supabase.from('subscriptions').update({ plan: 'free', status: 'canceled' }).eq('user_id', userId);
      }
      break;
    }

    case 'invoice.paid': {
      const invoice = payload;
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

    case 'invoice.payment_failed': {
      // Section 17, Stage G: dunning/retry decision lives in
      // handleInvoicePaymentFailed — mark past_due, log the retry
      // context, record a zero-amount history row; Stripe's
      // automatic retries keep running, nothing is cancelled here.
      // Shape is already normalized to `payload` above (route
      // shape and { object: invoice } both work).
      await handleInvoicePaymentFailed(supabase, payload);
      break;
    }

    default:
      logger.info('Unhandled webhook event type', { type: event.type });
  }

    // Section 18, item 46: the handlers ran to completion — stamp
    // the outcome (best-effort; see updateWebhookEventOutcome).
    await updateWebhookEventOutcome(supabase, event.id, 'processed');
  } catch (err) {
    // A handler threw: record the failure, then rethrow so the
    // route answers 500 and Stripe retries — the retry sees status
    // 'failed' and reprocesses instead of skipping (see above).
    await updateWebhookEventOutcome(
      supabase,
      event.id,
      'failed',
      err instanceof Error ? err.message : String(err)
    );
    throw err;
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
