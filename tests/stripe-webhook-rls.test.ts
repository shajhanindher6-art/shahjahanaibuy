/**
 * Stripe webhook RLS investigation (Section 15, P2-4 follow-up).
 *
 * FINDING — VERIFIED BROKEN by reading the route + migrations:
 * app/api/webhooks/stripe/route.ts built its Supabase client with
 * createSupabaseServerClient() (the ANON key, no session cookies
 * on a Stripe webhook request → the `anon` role), while every
 * table the webhook writes restricts writes to `authenticated`:
 * - subscriptions, migration 009: SELECT/INSERT/UPDATE TO
 *   authenticated, USING/WITH CHECK (auth.uid() = user_id);
 * - webhook_events, migration 012: SELECT TO authenticated only
 *   (no INSERT policy at all);
 * - billing_history, migration 012: SELECT/INSERT TO
 *   authenticated only.
 * So the idempotency insert, the subscription upsert and the
 * invoice insert were all RLS-denied, while the route still
 * returned 200 {received:true} — paid subscriptions silently
 * lost. FIX: the route now uses the service-role client (same
 * pattern as /api/v1/alerts/check and /api/v1/prices/refresh),
 * returns 503 when no service key is configured, and
 * processWebhookEvent throws on a failed event-record write so
 * Stripe retries instead of the event vanishing.
 *
 * These tests pin the fix: the route source must use the service
 * client (and never the anon server client), and a failed
 * webhook_events insert must surface as a throw, not a silent 200.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { processWebhookEvent } from '@/services/stripe';

/** Fake Supabase client covering only what processWebhookEvent calls. */
function fakeWebhookClient(options: {
  existing?: { id: string } | null;
  insertError?: { message: string } | null;
}) {
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    inserts,
    from(table: string) {
      if (table !== 'webhook_events') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: options.existing ?? null, error: null };
                },
              };
            },
          };
        },
        async insert(row: Record<string, unknown>) {
          inserts.push(row);
          return { error: options.insertError ?? null };
        },
      };
    },
  };
  return client;
}

describe('Stripe webhook route uses the service-role client', () => {
  it('builds its client with createSupabaseServiceClient, never the anon server client', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'app/api/webhooks/stripe/route.ts'),
      'utf8'
    );
    expect(source).toContain('createSupabaseServiceClient');
    expect(source).toContain("from '@/lib/supabase/service'");
    // No import of the anon-key server client, and no call to it
    // (the header comment names the old client in prose only).
    expect(source).not.toMatch(/createSupabaseServerClient\s*\(/);
    expect(source).not.toContain("from '@/lib/supabase/server'");
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});

describe('processWebhookEvent records the event or fails loudly', () => {
  it('records an unseen event in webhook_events', async () => {
    // No STRIPE_SECRET_KEY in the test env, so getStripe() is null
    // and processing stops right after the insert — the insert is
    // the behaviour under test here.
    const client = fakeWebhookClient({});
    await processWebhookEvent(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      { id: 'evt_test_1', type: 'customer.subscription.updated', data: {} }
    );
    expect(client.inserts).toHaveLength(1);
    expect(client.inserts[0].stripe_event_id).toBe('evt_test_1');
    expect(client.inserts[0].event_type).toBe('customer.subscription.updated');
  });

  it('skips the insert for an already-recorded event (idempotency)', async () => {
    const client = fakeWebhookClient({ existing: { id: 'row-1' } });
    await processWebhookEvent(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      { id: 'evt_test_2', type: 'customer.subscription.updated', data: {} }
    );
    expect(client.inserts).toHaveLength(0);
  });

  it('THROWS when the event record cannot be written (no silent 200)', async () => {
    const client = fakeWebhookClient({
      insertError: { message: 'new row violates row-level security policy' },
    });
    await expect(
      processWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client as any,
        { id: 'evt_test_3', type: 'customer.subscription.updated', data: {} }
      )
    ).rejects.toThrow('Failed to record webhook event evt_test_3');
  });
});
