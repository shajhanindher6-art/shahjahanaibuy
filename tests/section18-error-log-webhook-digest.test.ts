/**
 * Section 18, items 45/46/50 — error log, webhook outcome, digest failures.
 *
 * Covers, against mocked Supabase clients (no DB, no network):
 * - SQL-text assertions for the three new migration files
 *   (048 error_log, 049 webhook_events status/error, 050
 *   digest_failures): tables/columns/CHECKs/RLS/admin-read
 *   policy, DO NOT APPLY YET header, service-role-only writes.
 * - Webhook outcome update + reprocess-on-retry
 *   (services/stripe.ts): a failed handler marks the row
 *   'failed' with the error text; a Stripe retry of a 'failed'
 *   event reprocesses it instead of skipping; a processed event
 *   is still skipped; a missing status column (049 unapplied)
 *   keeps the old skip behaviour and never fails the webhook.
 * - Digest-failure persistence (services/notifications.ts):
 *   a failed per-user digest writes a digest_failures row with
 *   user_id + reason; a missing table (050 unapplied) logs and
 *   continues, never failing the digest.
 * - Error-log read service (services/error-log-admin.ts):
 *   recent rows, honest table-missing state, reported read error.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processWebhookEvent } from '@/services/stripe';
import {
  generateWeeklyDigest,
  recordDigestFailure,
} from '@/services/notifications';
import { listRecentErrors } from '@/services/error-log-admin';

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Migration SQL text
// ---------------------------------------------------------------------------

function readMigration(filename: string): string {
  return readFileSync(join(process.cwd(), 'supabase', 'migrations', filename), 'utf8');
}

const MIG_048 = '20261112210000_048_error_log.sql';
const MIG_049 = '20261112211000_049_webhook_events_status.sql';
const MIG_050 = '20261112212000_050_digest_failures.sql';

describe('migration 048 — error_log table', () => {
  it('creates the table with the level enum, context columns, RLS + admin-read policy, and DO NOT APPLY header', () => {
    const sql = readMigration(MIG_048);
    expect(sql).toContain('DO NOT APPLY YET');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.error_log');
    expect(sql).toContain("CHECK (level IN ('debug', 'info', 'warn', 'error', 'critical'))");
    expect(sql).toContain('message text NOT NULL');
    expect(sql).toContain('request_id text');
    expect(sql).toContain('route text');
    expect(sql).toContain('user_id uuid');
    expect(sql).toContain('meta jsonb');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FOR SELECT TO authenticated');
    expect(sql).toContain('public.is_admin()');
    // Service-role-only writes: no anon/authenticated write policy.
    expect(sql).not.toContain('FOR INSERT TO anon');
    expect(sql).not.toContain('FOR INSERT TO authenticated');
    expect(sql).not.toContain('FOR UPDATE TO anon');
    expect(sql).not.toContain('FOR UPDATE TO authenticated');
    expect(sql).not.toContain('FOR DELETE TO anon');
    expect(sql).not.toContain('FOR DELETE TO authenticated');
  });
});

describe('migration 049 — webhook_events status + error', () => {
  it('adds status/error columns with a CHECK, an index, and a DO NOT APPLY header', () => {
    const sql = readMigration(MIG_049);
    expect(sql).toContain('DO NOT APPLY YET');
    expect(sql).toContain('webhook_events');
    expect(sql).toContain('ADD COLUMN status');
    expect(sql).toContain("CHECK (status IN ('pending', 'processed', 'failed'))");
    expect(sql).toContain("DEFAULT 'pending'");
    expect(sql).toContain('ADD COLUMN error');
    expect(sql).toContain('idx_webhook_events_status');
  });
});

describe('migration 050 — digest_failures table', () => {
  it('creates the table with user_id + reason, RLS + admin-read policy, and DO NOT APPLY header', () => {
    const sql = readMigration(MIG_050);
    expect(sql).toContain('DO NOT APPLY YET');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.digest_failures');
    expect(sql).toContain('user_id uuid NOT NULL');
    expect(sql).toContain('reason text NOT NULL');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FOR SELECT TO authenticated');
    expect(sql).toContain('public.is_admin()');
    // Service-role-only writes: no anon/authenticated write policy.
    expect(sql).not.toContain('FOR INSERT TO anon');
    expect(sql).not.toContain('FOR INSERT TO authenticated');
    expect(sql).not.toContain('FOR UPDATE TO anon');
    expect(sql).not.toContain('FOR UPDATE TO authenticated');
    expect(sql).not.toContain('FOR DELETE TO anon');
    expect(sql).not.toContain('FOR DELETE TO authenticated');
  });
});

// ---------------------------------------------------------------------------
// Webhook outcome update + reprocess-on-retry (item 46)
// ---------------------------------------------------------------------------

const stripeState = vi.hoisted(() => ({ configured: true }));

vi.mock('@/lib/stripe', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/stripe')>();
  return {
    ...orig,
    getStripe: () => (stripeState.configured ? {} : null),
    isStripeConfigured: () => stripeState.configured,
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

const webhookDb = vi.hoisted(() => ({
  rows: [] as Row[],
  inserts: [] as Row[],
  billingInserts: [] as Row[],
  billingInsertThrows: false,
  statusReadError: null as { code: string; message: string } | null,
  updateError: null as { code: string; message: string } | null,
}));

function makeWebhookClient() {
  return {
    from: (table: string) => {
      if (table === 'webhook_events') {
        return {
          select: (cols: string) => ({
            eq: (_col: string, value: string) => ({
              maybeSingle: async () => {
                if (cols.includes('status') && webhookDb.statusReadError) {
                  return { data: null, error: webhookDb.statusReadError };
                }
                const row = webhookDb.rows.find((r) => r.stripe_event_id === value) ?? null;
                return { data: row, error: null };
              },
            }),
          }),
          insert: async (row: Row) => {
            webhookDb.rows.push({ ...row, status: 'pending', error: null });
            webhookDb.inserts.push(row);
            return { error: null };
          },
          update: (values: Row) => ({
            eq: async (_col: string, value: string) => {
              if (webhookDb.updateError) return { error: webhookDb.updateError };
              const row = webhookDb.rows.find((r) => r.stripe_event_id === value);
              if (row) Object.assign(row, values);
              return { error: null };
            },
          }),
        };
      }
      if (table === 'subscriptions') {
        return {
          select: () => ({
            eq: (_col: string, value: string) => ({
              maybeSingle: async () => ({
                data: { user_id: 'user-1', stripe_customer_id: value },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'billing_history') {
        return {
          insert: async (row: Row) => {
            if (webhookDb.billingInsertThrows) {
              throw new Error('billing insert boom');
            }
            webhookDb.billingInserts.push(row);
            return { error: null };
          },
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { email: 'user@example.com' }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** invoice.paid as the route passes it: data IS the Stripe object. */
function invoicePaidEvent(id: string) {
  return {
    id,
    type: 'invoice.paid',
    data: {
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
    },
  };
}

describe('processWebhookEvent outcome update + reprocess-on-retry (item 46)', () => {
  beforeEach(() => {
    webhookDb.rows = [];
    webhookDb.inserts = [];
    webhookDb.billingInserts = [];
    webhookDb.billingInsertThrows = false;
    webhookDb.statusReadError = null;
    webhookDb.updateError = null;
    stripeState.configured = true;
  });

  it('marks a handled event processed with a null error', async () => {
    const client = makeWebhookClient();
    await processWebhookEvent(client, invoicePaidEvent('evt_ok_1'));
    expect(webhookDb.inserts).toHaveLength(1);
    expect(webhookDb.billingInserts).toHaveLength(1);
    expect(webhookDb.rows[0]).toMatchObject({
      stripe_event_id: 'evt_ok_1',
      status: 'processed',
      error: null,
    });
  });

  it('skips an already-processed event on redelivery (no duplicate handler work)', async () => {
    const client = makeWebhookClient();
    await processWebhookEvent(client, invoicePaidEvent('evt_ok_2'));
    await processWebhookEvent(client, invoicePaidEvent('evt_ok_2'));
    expect(webhookDb.inserts).toHaveLength(1);
    expect(webhookDb.billingInserts).toHaveLength(1);
    expect(webhookDb.rows[0]).toMatchObject({ status: 'processed' });
  });

  it('marks a failed handler failed with the error text, reprocesses it on Stripe retry, then skips once processed', async () => {
    const client = makeWebhookClient();
    webhookDb.billingInsertThrows = true;

    // First delivery: the handler throws → the row is 'failed'
    // and the error propagates (route 500 → Stripe retries).
    await expect(processWebhookEvent(client, invoicePaidEvent('evt_fail_1'))).rejects.toThrow(
      'billing insert boom'
    );
    expect(webhookDb.rows).toHaveLength(1);
    expect(webhookDb.rows[0]).toMatchObject({ status: 'failed' });
    expect(String(webhookDb.rows[0].error)).toContain('billing insert boom');
    expect(webhookDb.billingInserts).toHaveLength(0);

    // Stripe retry: the 'failed' row is REPROCESSED, not skipped —
    // no second idempotency insert, the handler runs again.
    webhookDb.billingInsertThrows = false;
    await processWebhookEvent(client, invoicePaidEvent('evt_fail_1'));
    expect(webhookDb.inserts).toHaveLength(1);
    expect(webhookDb.billingInserts).toHaveLength(1);
    expect(webhookDb.rows[0]).toMatchObject({ status: 'processed', error: null });

    // A third delivery is a normal duplicate and is skipped.
    await processWebhookEvent(client, invoicePaidEvent('evt_fail_1'));
    expect(webhookDb.inserts).toHaveLength(1);
    expect(webhookDb.billingInserts).toHaveLength(1);
  });

  it('marks the event failed (not pending forever) when Stripe is unconfigured', async () => {
    stripeState.configured = false;
    const client = makeWebhookClient();
    await processWebhookEvent(client, invoicePaidEvent('evt_nostripe_1'));
    expect(webhookDb.rows[0]).toMatchObject({
      status: 'failed',
      error: 'Stripe is not configured',
    });
  });

  it('keeps the old skip behaviour and never fails the webhook when the status column is missing (049 unapplied)', async () => {
    // 42703 on both the status read and the outcome update.
    webhookDb.statusReadError = { code: '42703', message: 'column "status" does not exist' };
    webhookDb.updateError = { code: '42703', message: 'column "status" does not exist' };
    const client = makeWebhookClient();

    // First delivery still succeeds — the outcome write is
    // best-effort, never a 500 over bookkeeping.
    await processWebhookEvent(client, invoicePaidEvent('evt_nocol_1'));
    expect(webhookDb.billingInserts).toHaveLength(1);
    // The row keeps its insert-time 'pending' (the update failed).
    expect(webhookDb.rows[0]).toMatchObject({ status: 'pending' });

    // Redelivery: the status read errors, so the old skip path
    // applies — the handler does NOT run twice.
    await processWebhookEvent(client, invoicePaidEvent('evt_nocol_1'));
    expect(webhookDb.billingInserts).toHaveLength(1);
    expect(webhookDb.inserts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Digest failure persistence (item 50)
// ---------------------------------------------------------------------------

const digestDb = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  insertErrorTables: new Set<string>(),
}));

function seedDigestTables() {
  digestDb.tables = {
    deals: [],
    price_alert_history: [],
    search_history: [],
    weekly_digests: [] as Row[],
    notification_queue: [] as Row[],
    notifications: [] as Row[],
    digest_failures: [] as Row[],
  };
}

function makeDigestClient() {
  return {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      let limitN: number | undefined;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, value: unknown) => {
          filters.push((r) => r[col] === value);
          return chain;
        },
        in: (col: string, values: unknown[]) => {
          filters.push((r) => values.includes(r[col]));
          return chain;
        },
        is: (col: string, value: unknown) => {
          filters.push((r) => (value === null ? r[col] == null : r[col] === value));
          return chain;
        },
        gte: () => chain,
        order: () => chain,
        limit: (n: number) => {
          limitN = n;
          return chain;
        },
        insert: async (row: Row) => {
          if (digestDb.insertErrorTables.has(table)) {
            return { error: { code: '42P01', message: `relation "${table}" does not exist` }, data: null };
          }
          (digestDb.tables[table] ??= []).push({ ...row });
          return { error: null, data: [row] };
        },
        then: (resolve: (value: unknown) => void) => {
          let rows = [...(digestDb.tables[table] ?? [])].filter((r) =>
            filters.every((f) => f(r))
          );
          if (limitN !== undefined) rows = rows.slice(0, limitN);
          resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('digest failure persistence (item 50)', () => {
  beforeEach(() => {
    seedDigestTables();
    digestDb.insertErrorTables = new Set();
  });

  it('persists the failed user_id + reason when the digest insert fails', async () => {
    digestDb.insertErrorTables = new Set(['weekly_digests']);
    const client = makeDigestClient();
    const result = await generateWeeklyDigest(client, 'user-premium');
    expect(result).toBeNull();
    expect(digestDb.tables.digest_failures).toHaveLength(1);
    expect(digestDb.tables.digest_failures[0]).toMatchObject({ user_id: 'user-premium' });
    expect(String(digestDb.tables.digest_failures[0].reason)).toContain(
      'weekly_digests insert failed'
    );
  });

  it('writes no failure row when the digest succeeds', async () => {
    const client = makeDigestClient();
    const result = await generateWeeklyDigest(client, 'user-premium');
    expect(result).not.toBeNull();
    expect(digestDb.tables.digest_failures).toHaveLength(0);
  });

  it('recordDigestFailure resolves without throwing when the table is missing (050 unapplied)', async () => {
    digestDb.insertErrorTables = new Set(['digest_failures']);
    const client = makeDigestClient();
    await expect(
      recordDigestFailure(client, 'user-premium', 'weekly_digests insert failed: denied')
    ).resolves.toBeUndefined();
    expect(digestDb.tables.digest_failures).toHaveLength(0);
  });

  it('recordDigestFailure resolves without throwing when the client itself throws', async () => {
    const throwingClient = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: () => {
        throw new Error('client boom');
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await expect(
      recordDigestFailure(throwingClient, 'user-premium', 'weekly_digests insert failed: denied')
    ).resolves.toBeUndefined();
  });

  it('recordDigestFailure stores the row when the table exists', async () => {
    const client = makeDigestClient();
    await recordDigestFailure(client, 'user-premium', 'weekly_digests insert failed: denied');
    expect(digestDb.tables.digest_failures).toHaveLength(1);
    expect(digestDb.tables.digest_failures[0]).toMatchObject({
      user_id: 'user-premium',
      reason: 'weekly_digests insert failed: denied',
    });
  });
});

// ---------------------------------------------------------------------------
// Error-log read service (item 45)
// ---------------------------------------------------------------------------

const ERROR_ROWS: Row[] = [
  {
    id: 'e-1',
    created_at: '2026-11-12T20:00:00.000Z',
    level: 'error',
    message: 'Webhook processing failed',
    request_id: null,
    route: '/api/webhooks/stripe',
    user_id: null,
    meta: {},
  },
  {
    id: 'e-2',
    created_at: '2026-11-12T19:00:00.000Z',
    level: 'warn',
    message: 'Digest queue insert failed',
    request_id: null,
    route: '/api/v1/notifications/digest',
    user_id: 'user-1',
    meta: {},
  },
];

function makeErrorLogClient(mode: 'ok' | 'missing' | 'error' | 'throws') {
  return {
    from: () => {
      if (mode === 'throws') throw new Error('client boom');
      return {
        select: () => ({
          order: () => ({
            limit: async () => {
              if (mode === 'missing') {
                return {
                  data: null,
                  error: { code: '42P01', message: 'relation "error_log" does not exist' },
                };
              }
              if (mode === 'error') {
                return { data: null, error: { code: 'XX000', message: 'boom' } };
              }
              return { data: ERROR_ROWS, error: null };
            },
          }),
        }),
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('listRecentErrors (item 45)', () => {
  it('returns the most recent error rows', async () => {
    const result = await listRecentErrors(makeErrorLogClient('ok'), 20);
    expect(result.tableMissing).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({
      level: 'error',
      message: 'Webhook processing failed',
      route: '/api/webhooks/stripe',
    });
  });

  it('reports tableMissing (not a 500, not invented rows) when migration 048 is unapplied', async () => {
    const result = await listRecentErrors(makeErrorLogClient('missing'), 20);
    expect(result).toEqual({ errors: [], tableMissing: true });
  });

  it('reports a non-missing-table read error instead of treating it as "no errors"', async () => {
    const result = await listRecentErrors(makeErrorLogClient('error'), 20);
    expect(result.tableMissing).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.error).toBe('boom');
  });

  it('reports a client throw as an error, never throws', async () => {
    const result = await listRecentErrors(makeErrorLogClient('throws'), 20);
    expect(result.tableMissing).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.error).toBe('client boom');
  });
});
