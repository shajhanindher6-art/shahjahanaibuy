/**
 * Section 19, Phase 0 (§12 #65) — notification master switches.
 *
 * `user_settings.email_notifications / push_notifications /
 * price_alerts` were editable in settings but never read: a user
 * who turned alerts off still got queued + dispatched alerts.
 *
 * These tests pin the fix at BOTH enforcement points:
 * 1. checkPriceAlerts (before queueing) — an opted-out user gets
 *    no queued alert, no trigger record, no last_triggered_at
 *    update (skippedOptedOut counts them).
 * 2. processNotificationQueue / dispatchNotification (before
 *    dispatching) — a row queued before the user opted out is
 *    never delivered (failed permanently, sender never called).
 *
 * The Supabase client is a small chainable stub (thenable builder
 * with eq / neq / in / is / gte / lte / order / limit /
 * maybeSingle / insert / update) that records inserts + updates
 * so tests assert behaviour (which rows were written), not just
 * call shapes. The email sender is mocked; RESEND_API_KEY is
 * supplied through a mocked env so the email leg is genuinely
 * sendable and the tests can discriminate opt-out from "no key".
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { checkPriceAlerts } from '@/services/alert-checker';
import { processNotificationQueue } from '@/services/notification-dispatch';
import { sendPriceAlertEmail } from '@/services/email';
import type { AnySupabaseClient } from '@/lib/supabase/types';

vi.mock('@/lib/config/env', async (importOriginal) => {
  const actual = (await importOriginal()) as { env: Record<string, unknown> };
  return { env: { ...actual.env, resendApiKey: 'test-resend-key' } };
});

vi.mock('@/services/email', () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
  sendWeeklyDigestEmail: vi.fn(async () => ({ success: true })),
  sendPriceAlertEmail: vi.fn(async () => ({ success: true })),
}));

const mockedSendPriceAlertEmail = vi.mocked(sendPriceAlertEmail);

type Row = Record<string, unknown>;

interface StubDb {
  client: AnySupabaseClient;
  inserts: Array<{ table: string; row: Row }>;
  updates: Array<{ table: string; patch: Row; filters: Array<{ op: string; column: string; value: unknown }> }>;
}

function createStubSupabase(tables: Record<string, Row[]>): StubDb {
  const inserts: StubDb['inserts'] = [];
  const updates: StubDb['updates'] = [];
  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const filters: Array<{ op: string; column: string; value: unknown }> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ op: 'eq', column: col, value: val });
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      neq(col: string, val: unknown) {
        filters.push({ op: 'neq', column: col, value: val });
        rows = rows.filter((r) => r[col] !== val);
        return builder;
      },
      gte(col: string, val: unknown) {
        rows = rows.filter((r) => String(r[col]) >= String(val));
        return builder;
      },
      lte(col: string, val: unknown) {
        rows = rows.filter((r) => String(r[col]) <= String(val));
        return builder;
      },
      in(col: string, vals: unknown[]) {
        rows = rows.filter((r) => vals.includes(r[col]));
        return builder;
      },
      is(col: string, val: unknown) {
        rows = rows.filter((r) =>
          val === null ? r[col] === null || r[col] === undefined : r[col] === val
        );
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        const asc = opts?.ascending !== false;
        rows = [...rows].sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av === bv) return 0;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          if (typeof av === 'number' && typeof bv === 'number') {
            return asc ? av - bv : bv - av;
          }
          return asc
            ? String(av).localeCompare(String(bv))
            : String(bv).localeCompare(String(av));
        });
        return builder;
      },
      limit(n: number) {
        rows = rows.slice(0, n);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      insert(row: Row) {
        inserts.push({ table, row });
        return Promise.resolve({ data: null, error: null });
      },
      update(patch: Row) {
        updates.push({ table, patch, filters: [...filters] });
        return builder;
      },
      then(
        onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };
  return {
    client: { from: (table: string) => query(table) } as unknown as AnySupabaseClient,
    inserts,
    updates,
  };
}

const PRODUCTS: Row[] = [
  { id: 'p1', name: 'Sony Headphones', slug: 'sony-headphones' },
];

const PRICE_HISTORY: Row[] = [
  { product_id: 'p1', price: 90, availability: 'in_stock', recorded_at: '2026-11-12T10:00:00.000Z' },
];

function alertRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'a1',
    user_id: 'u1',
    product_id: 'p1',
    alert_type: 'price_drop',
    condition_value: 100,
    channel: 'email',
    active: true,
    last_triggered_at: null,
    trigger_count: 0,
    ...overrides,
  };
}

function settingsRow(overrides: Partial<Row> = {}): Row {
  return {
    user_id: 'u1',
    email_notifications: true,
    push_notifications: true,
    price_alerts: true,
    ...overrides,
  };
}

function checkerDb(alerts: Row[], settings: Row[]): StubDb {
  return createStubSupabase({
    alerts,
    products: PRODUCTS,
    price_history: PRICE_HISTORY,
    merchant_products: [],
    price_alert_history: [],
    user_settings: settings,
  });
}

beforeEach(() => {
  mockedSendPriceAlertEmail.mockClear();
});

describe('checkPriceAlerts honours the master switches (before queueing)', () => {
  it('price_alerts off → nothing queued, no trigger recorded, counted as skippedOptedOut', async () => {
    const db = checkerDb([alertRow()], [settingsRow({ price_alerts: false })]);
    const result = await checkPriceAlerts(db.client);

    expect(result.checked).toBe(1);
    expect(result.triggered).toBe(0);
    expect(result.queued).toBe(0);
    expect(result.skippedOptedOut).toBe(1);
    expect(result.failed).toBe(0);
    expect(db.inserts.filter((i) => i.table === 'notification_queue')).toHaveLength(0);
    expect(db.inserts.filter((i) => i.table === 'price_alert_history')).toHaveLength(0);
    expect(db.updates.filter((u) => u.table === 'alerts')).toHaveLength(0);
  });

  it('all switches on → the alert queues exactly as before', async () => {
    const db = checkerDb([alertRow()], [settingsRow()]);
    const result = await checkPriceAlerts(db.client);

    expect(result.triggered).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.skippedOptedOut).toBe(0);
    const queued = db.inserts.filter((i) => i.table === 'notification_queue');
    expect(queued).toHaveLength(1);
    expect(queued[0].row.channel).toBe('email');
    expect(queued[0].row.type).toBe('price_alert');
  });

  it('email_notifications off + email channel → skipped; the opted-in user still queues', async () => {
    const db = checkerDb(
      [alertRow({ id: 'a1', user_id: 'u1' }), alertRow({ id: 'a2', user_id: 'u2' })],
      [settingsRow({ user_id: 'u1', email_notifications: false }), settingsRow({ user_id: 'u2' })]
    );
    const result = await checkPriceAlerts(db.client);

    expect(result.queued).toBe(1);
    expect(result.skippedOptedOut).toBe(1);
    const queued = db.inserts.filter((i) => i.table === 'notification_queue');
    expect(queued).toHaveLength(1);
    expect(queued[0].row.user_id).toBe('u2');
  });

  it("'both' channel with email off degrades to push instead of dropping or mis-sending", async () => {
    const db = checkerDb(
      [alertRow({ channel: 'both' })],
      [settingsRow({ email_notifications: false, push_notifications: true })]
    );
    const result = await checkPriceAlerts(db.client);

    expect(result.queued).toBe(1);
    expect(result.skippedOptedOut).toBe(0);
    const queued = db.inserts.filter((i) => i.table === 'notification_queue');
    expect(queued[0].row.channel).toBe('push');
  });

  it("'both' channel with both channels off → skipped", async () => {
    const db = checkerDb(
      [alertRow({ channel: 'both' })],
      [settingsRow({ email_notifications: false, push_notifications: false })]
    );
    const result = await checkPriceAlerts(db.client);

    expect(result.queued).toBe(0);
    expect(result.skippedOptedOut).toBe(1);
  });

  it('no settings row at all → defaults (all on) → the alert queues', async () => {
    const db = checkerDb([alertRow()], []);
    const result = await checkPriceAlerts(db.client);

    expect(result.queued).toBe(1);
    expect(result.skippedOptedOut).toBe(0);
  });
});

describe('processNotificationQueue honours the master switches (before dispatching)', () => {
  function dispatchDb(settings: Row[]): StubDb {
    return createStubSupabase({
      notification_queue: [
        {
          id: 'q1',
          user_id: 'u1',
          type: 'price_alert',
          channel: 'email',
          subject: 'Price drop alert: Sony Headphones is now $90.00!',
          body: 'Great news!',
          data: {
            productName: 'Sony Headphones',
            productSlug: 'sony-headphones',
            triggeredPrice: 90,
            targetPrice: 100,
            productUrl: 'https://example.test/products/sony-headphones',
          },
          retry_count: 0,
          max_retries: 3,
          scheduled_for: '2026-01-01T00:00:00.000Z',
          status: 'pending',
        },
      ],
      profiles: [{ id: 'u1', email: 'u1@example.test' }],
      user_settings: settings,
    });
  }

  it('price_alerts off → never delivered, sender never called, row failed permanently', async () => {
    const db = dispatchDb([settingsRow({ price_alerts: false })]);
    const result = await processNotificationQueue(db.client);

    expect(result).toEqual({ processed: 1, sent: 0, failed: 1, partial: 0 });
    expect(mockedSendPriceAlertEmail).not.toHaveBeenCalled();
    const failed = db.updates.filter(
      (u) => u.table === 'notification_queue' && u.patch.status === 'failed'
    );
    expect(failed).toHaveLength(1);
  });

  it('all switches on → the email is sent and the row is marked sent', async () => {
    const db = dispatchDb([settingsRow()]);
    const result = await processNotificationQueue(db.client);

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0, partial: 0 });
    expect(mockedSendPriceAlertEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendPriceAlertEmail).toHaveBeenCalledWith(
      'u1@example.test',
      'Sony Headphones',
      90,
      100,
      'https://example.test/products/sony-headphones'
    );
    const sent = db.updates.filter(
      (u) => u.table === 'notification_queue' && u.patch.status === 'sent'
    );
    expect(sent).toHaveLength(1);
  });

  it('email_notifications off → the email leg never fires, row failed permanently', async () => {
    const db = dispatchDb([settingsRow({ email_notifications: false })]);
    const result = await processNotificationQueue(db.client);

    expect(result).toEqual({ processed: 1, sent: 0, failed: 1, partial: 0 });
    expect(mockedSendPriceAlertEmail).not.toHaveBeenCalled();
  });
});
