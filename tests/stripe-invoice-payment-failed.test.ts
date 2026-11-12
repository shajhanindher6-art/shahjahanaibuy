/**
 * Stripe invoice.payment_failed handler (Section 17, Stage G).
 *
 * The audit (§3) found failed payments fall into the `default:`
 * log-only branch of processWebhookEvent — no dunning or retry
 * decision in code. The handler added here marks the subscription
 * `past_due` (suspending the paid quota until a later invoice.paid
 * / subscription.updated event restores it), logs the retry
 * context, and records a zero-amount billing_history row — while
 * relying on Stripe's automatic retries instead of cancelling
 * anything. TEST mode only; no live Stripe call is ever made —
 * the events below are fabricated, and the Stripe client is a
 * local stub.
 *
 * Two shapes of fabricated event are covered, because the webhook
 * route passes `event.data.object` as `data` while the handlers
 * were written against `event.data.object`: the handler must work
 * under both.
 */
import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleInvoicePaymentFailed, processWebhookEvent } from '@/services/stripe';

type SubRow = Record<string, unknown>;

const stripeStub = vi.hoisted(() => ({
  retrieve: async () => ({
    id: 'sub_123',
    customer: 'cus_123',
    status: 'past_due',
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

/** Fabricated invoice.payment_failed payload — never a live Stripe call. */
const FAILED_INVOICE: Record<string, unknown> = {
  id: 'in_test_failed_1',
  object: 'invoice',
  customer: 'cus_123',
  subscription: 'sub_123',
  status: 'open',
  amount_due: 999,
  amount_paid: 0,
  currency: 'usd',
  attempt_count: 1,
  next_payment_attempt: 1794000000,
  charge: null,
  hosted_invoice_url: 'https://pay.stripe.com/invoice/test',
  invoice_pdf: 'https://pay.stripe.com/invoice/test/pdf',
  period_start: 1762900000,
  period_end: 1765500000,
};

/** Fake Supabase client covering only what the handler + sync call. */
function makeFakeClient(options: {
  subs?: SubRow[];
  historyError?: { message: string } | null;
  updateError?: { message: string } | null;
} = {}) {
  const subsByCustomer = new Map<string, SubRow>();
  const subsByUser = new Map<string, SubRow>();
  const seed = (row: SubRow) => {
    if (typeof row.stripe_customer_id === 'string') subsByCustomer.set(row.stripe_customer_id, row);
    if (typeof row.user_id === 'string') subsByUser.set(row.user_id, row);
  };
  for (const row of options.subs ?? []) seed(row);
  const historyInserts: Array<Record<string, unknown>> = [];
  const webhookInserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    historyInserts,
    webhookInserts,
    updates,
    subsByCustomer,
    subsByUser,
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
                    return {
                      data: subsByCustomer.get(value) ?? subsByUser.get(value) ?? null,
                      error: null,
                    };
                  },
                };
              },
            };
          },
          update(values: Record<string, unknown>) {
            return {
              eq: async (_col: string, value: string) => {
                updates.push({ ...values, _eq: value });
                if (options.updateError) return { error: options.updateError };
                const row = subsByCustomer.get(value) ?? subsByUser.get(value);
                if (row) Object.assign(row, values);
                return { error: null };
              },
            };
          },
          async upsert(row: Record<string, unknown>) {
            seed({ ...row });
            return { error: null };
          },
        };
      }
      if (table === 'billing_history') {
        return {
          async insert(row: Record<string, unknown>) {
            historyInserts.push(row);
            return { error: options.historyError ?? null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return client;
}

function activePremiumRow(): SubRow {
  return {
    user_id: 'user-1',
    plan: 'premium',
    status: 'active',
    stripe_customer_id: 'cus_123',
    stripe_subscription_id: 'sub_123',
  };
}

describe('handleInvoicePaymentFailed — direct unit tests', () => {
  it('marks the subscription past_due, keeps the plan, records a zero-amount failed-payment row', async () => {
    const client = makeFakeClient({ subs: [activePremiumRow()] });
    // No subscription id here: isolates the mark + history behaviour
    // from the Stripe sync step (covered by the dispatch tests).
    const { subscription: _sub, ...invoice } = FAILED_INVOICE;
    await handleInvoicePaymentFailed(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      invoice
    );
    expect(client.subsByCustomer.get('cus_123')).toMatchObject({
      plan: 'premium',
      status: 'past_due',
    });
    expect(client.historyInserts).toHaveLength(1);
    expect(client.historyInserts[0]).toMatchObject({
      user_id: 'user-1',
      stripe_invoice_id: 'in_test_failed_1',
      amount_paid: 0,
      currency: 'usd',
      status: 'payment_failed',
    });
  });

  it('does nothing (no update, no history) when the invoice has no customer id', async () => {
    const client = makeFakeClient({ subs: [activePremiumRow()] });
    const { customer: _c, ...invoice } = FAILED_INVOICE;
    await handleInvoicePaymentFailed(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      invoice
    );
    expect(client.updates).toHaveLength(0);
    expect(client.historyInserts).toHaveLength(0);
    expect(client.subsByCustomer.get('cus_123')).toMatchObject({ status: 'active' });
  });

  it('does nothing when the customer has no local subscription row', async () => {
    const client = makeFakeClient({ subs: [] });
    const { subscription: _sub, ...invoice } = FAILED_INVOICE;
    await handleInvoicePaymentFailed(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      invoice
    );
    expect(client.updates).toHaveLength(0);
    expect(client.historyInserts).toHaveLength(0);
  });

  it('does NOT throw when the past_due update fails (logs instead)', async () => {
    const client = makeFakeClient({
      subs: [activePremiumRow()],
      updateError: { message: 'update denied' },
    });
    const { subscription: _sub, ...invoice } = FAILED_INVOICE;
    await expect(
      handleInvoicePaymentFailed(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client as any,
        invoice
      )
    ).resolves.toBeUndefined();
  });

  it('does NOT throw when the billing_history insert fails (logs instead)', async () => {
    const client = makeFakeClient({
      subs: [activePremiumRow()],
      historyError: { message: 'insert denied' },
    });
    const { subscription: _sub, ...invoice } = FAILED_INVOICE;
    await expect(
      handleInvoicePaymentFailed(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client as any,
        invoice
      )
    ).resolves.toBeUndefined();
    expect(client.subsByCustomer.get('cus_123')).toMatchObject({ status: 'past_due' });
  });
});

describe('processWebhookEvent dispatches invoice.payment_failed', () => {
  it('handles the ROUTE shape (data IS the invoice object) end to end', async () => {
    const client = makeFakeClient({ subs: [activePremiumRow()] });
    await processWebhookEvent(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      { id: 'evt_failed_1', type: 'invoice.payment_failed', data: { ...FAILED_INVOICE } }
    );
    expect(client.webhookInserts).toHaveLength(1);
    expect(client.webhookInserts[0].event_type).toBe('invoice.payment_failed');
    expect(client.subsByCustomer.get('cus_123')).toMatchObject({
      plan: 'premium',
      status: 'past_due',
    });
    expect(client.historyInserts).toHaveLength(1);
    expect(client.historyInserts[0]).toMatchObject({
      user_id: 'user-1',
      stripe_invoice_id: 'in_test_failed_1',
      amount_paid: 0,
      status: 'payment_failed',
    });
  });

  it('handles the { object: invoice } shape too', async () => {
    const client = makeFakeClient({ subs: [activePremiumRow()] });
    await processWebhookEvent(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      {
        id: 'evt_failed_2',
        type: 'invoice.payment_failed',
        data: { object: { ...FAILED_INVOICE } },
      }
    );
    expect(client.subsByCustomer.get('cus_123')).toMatchObject({ status: 'past_due' });
    expect(client.historyInserts).toHaveLength(1);
  });
});

describe('invoice.payment_failed is a real switch case, not the default branch', () => {
  it('services/stripe.ts has the case and calls handleInvoicePaymentFailed', () => {
    const source = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'services', 'stripe.ts'),
      'utf8'
    );
    expect(source).toContain("case 'invoice.payment_failed'");
    expect(source).toContain('handleInvoicePaymentFailed');
    expect(source).toContain("status: 'past_due'");
  });
});
