/**
 * Stripe webhook event-shape regression (Section 17 fix worker).
 *
 * BUG (verified in code): app/api/webhooks/stripe/route.ts passes
 * `event.data.object` as `data` into processWebhookEvent, so `data`
 * IS the Stripe object and its `object` field is just the type
 * string ('checkout.session' / 'subscription' / 'invoice'). Every
 * handler in services/stripe.ts read `event.data.object` as the
 * payload, so under the route's real call shape
 * `checkout.session.completed`, `customer.subscription.updated` /
 * `.deleted` and `invoice.paid` silently no-op'd live (guarded
 * undefined lookups) — only the webhook_events idempotency row was
 * ever written. Only `invoice.payment_failed` already resolved
 * both shapes. FIX: processWebhookEvent normalizes the shape once
 * (`payload`) and all handlers use it.
 *
 * These tests construct events EXACTLY as the route does — data is
 * the Stripe object itself — pass them through processWebhookEvent,
 * and assert the handler's real effect (subscription sync /
 * billing-history write / email attempt), not a silent no-op.
 * Stubbed Stripe client + fabricated events; never a live call.
 * Stripe stays in TEST mode.
 */
import { describe, expect, it, vi } from 'vitest';
import { processWebhookEvent } from '@/services/stripe';

const stripeStub = vi.hoisted(() => ({
  retrieve: async () => ({
    id: 'sub_123',
    customer: 'cus_123',
    status: 'active',
    metadata: { userId: 'user-1', plan: 'premium' },
    current_period_start: 1762900000,
    current_period_end: 1765500000,
    canceled_at: null,
    ended_at: null,
    trial_start: null,
    trial_end: null,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_test' }, quantity: 1 }] },
  }),
}));

vi.mock('@/lib/stripe', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/stripe')>();
  return {
    ...orig,
    getStripe: () => ({ subscriptions: { retrieve: stripeStub.retrieve } }),
    isStripeConfigured: () => true,
  };
});

const emailMocks = vi.hoisted(() => ({
  sendSubscriptionEmail: vi.fn(async () => ({ success: true })),
  sendInvoiceEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/services/email', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/services/email')>();
  return {
    ...orig,
    sendSubscriptionEmail: emailMocks.sendSubscriptionEmail,
    sendInvoiceEmail: emailMocks.sendInvoiceEmail,
  };
});

type SubRow = Record<string, unknown>;

/** Fake Supabase client covering what processWebhookEvent calls. */
function makeFakeClient() {
  const subsByCustomer = new Map<string, SubRow>([
    ['cus_123', { user_id: 'user-1', stripe_customer_id: 'cus_123' }],
  ]);
  const upserts: Array<Record<string, unknown>> = [];
  const historyInserts: Array<Record<string, unknown>> = [];
  const webhookInserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    upserts,
    historyInserts,
    webhookInserts,
    updates,
    from(table: string) {
      if (table === 'webhook_events') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
          async insert(row: Record<string, unknown>) {
            webhookInserts.push(row);
            return { error: null };
          },
        };
      }
      if (table === 'subscriptions') {
        return {
          select() {
            return {
              eq(_col: string, value: string) {
                return {
                  async maybeSingle() {
                    return { data: subsByCustomer.get(value) ?? null, error: null };
                  },
                };
              },
            };
          },
          update(values: Record<string, unknown>) {
            return {
              eq: async (_col: string, value: string) => {
                updates.push({ ...values, _eq: value });
                return { error: null };
              },
            };
          },
          async upsert(row: Record<string, unknown>) {
            upserts.push(row);
            return { error: null };
          },
        };
      }
      if (table === 'billing_history') {
        return {
          async insert(row: Record<string, unknown>) {
            historyInserts.push(row);
            return { error: null };
          },
        };
      }
      if (table === 'profiles') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: { email: 'user@example.com' }, error: null };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return client;
}

/** Exactly what the route passes: data IS the Stripe object. */
function asRouteShape(id: string, type: string, object: Record<string, unknown>) {
  return { id, type, data: { ...object } };
}

describe('processWebhookEvent under the route\'s real call shape (data IS the Stripe object)', () => {
  it('checkout.session.completed syncs the subscription and sends the email', async () => {
    const client = makeFakeClient();
    await processWebhookEvent(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      asRouteShape('evt_checkout_1', 'checkout.session.completed', {
        id: 'cs_test_1',
        object: 'checkout.session',
        subscription: 'sub_123',
        customer: 'cus_123',
        customer_email: 'user@example.com',
        metadata: { userId: 'user-1', plan: 'premium' },
      })
    );
    expect(client.webhookInserts).toHaveLength(1);
    // The handler's effect: syncSubscriptionFromStripe ran (upsert),
    // not a silent no-op on the 'checkout.session' string.
    expect(client.upserts).toHaveLength(1);
    expect(client.upserts[0]).toMatchObject({
      user_id: 'user-1',
      plan: 'premium',
      status: 'active',
      stripe_subscription_id: 'sub_123',
    });
    expect(emailMocks.sendSubscriptionEmail).toHaveBeenCalledWith(
      'user@example.com',
      'premium',
      'active'
    );
  });

  it('customer.subscription.updated syncs the subscription', async () => {
    const client = makeFakeClient();
    await processWebhookEvent(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      asRouteShape('evt_sub_upd_1', 'customer.subscription.updated', {
        id: 'sub_123',
        object: 'subscription',
        customer: 'cus_123',
        status: 'active',
      })
    );
    expect(client.upserts).toHaveLength(1);
    expect(client.upserts[0]).toMatchObject({
      user_id: 'user-1',
      stripe_subscription_id: 'sub_123',
    });
  });

  it('invoice.paid writes billing history and sends the invoice email', async () => {
    const client = makeFakeClient();
    await processWebhookEvent(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      asRouteShape('evt_invoice_1', 'invoice.paid', {
        id: 'in_test_1',
        object: 'invoice',
        customer: 'cus_123',
        subscription: 'sub_123',
        amount_paid: 499,
        currency: 'usd',
        status: 'paid',
        charge: 'ch_test_1',
        hosted_invoice_url: 'https://pay.stripe.com/invoice/test',
        invoice_pdf: 'https://pay.stripe.com/invoice/test/pdf',
        period_start: 1762900000,
        period_end: 1765500000,
      })
    );
    expect(client.historyInserts).toHaveLength(1);
    expect(client.historyInserts[0]).toMatchObject({
      user_id: 'user-1',
      stripe_invoice_id: 'in_test_1',
      stripe_charge_id: 'ch_test_1',
      amount_paid: 499,
      currency: 'usd',
      status: 'paid',
    });
    expect(emailMocks.sendInvoiceEmail).toHaveBeenCalledWith(
      'user@example.com',
      499,
      'usd',
      'https://pay.stripe.com/invoice/test'
    );
  });
});

describe('processWebhookEvent still accepts the { data: { object } } shape', () => {
  it('checkout.session.completed works when the object sits under data.object', async () => {
    const client = makeFakeClient();
    await processWebhookEvent(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      {
        id: 'evt_checkout_2',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_2',
            object: 'checkout.session',
            subscription: 'sub_123',
            customer: 'cus_123',
            customer_email: 'user@example.com',
            metadata: { userId: 'user-1', plan: 'premium' },
          },
        },
      }
    );
    expect(client.upserts).toHaveLength(1);
    expect(client.upserts[0]).toMatchObject({ user_id: 'user-1', plan: 'premium' });
  });
});
