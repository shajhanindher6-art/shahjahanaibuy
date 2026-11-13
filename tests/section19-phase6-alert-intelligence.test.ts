/**
 * Section 19, Phase 6 (§12 #61–#64, #67–#69) — deal + alert intelligence.
 *
 * Pure-evaluator tests (no DB) plus checker tests against the same
 * chainable Supabase stub pattern as the Phase 0 switch tests, with
 * one addition: a per-table `from()` call counter, so the #69
 * batched-deals fix is asserted by counting queries, not by trust.
 *
 * All timestamps are relative to Date.now() so the tests do not go
 * stale: trend/inflation windows are measured from the latest
 * recorded point, freshness from the recorded check date.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateSignificantDrop,
  evaluateTrend,
  evaluateWishlistItemTriggers,
  evaluateOpportunityAlert,
  SIGNIFICANT_DROP_THRESHOLD_PCT,
} from '@/services/alert-triggers';
import { checkPriceAlerts } from '@/services/alert-checker';
import { createAlert } from '@/services/alerts';
import { shouldTriggerGuestAlert } from '@/lib/local-alerts';
import type { FakeSalePoint } from '@/services/fake-sale';
import type { AnySupabaseClient } from '@/lib/supabase/types';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const daysAgo = (d: number) => iso(now - d * DAY);

type Row = Record<string, unknown>;

function point(price: number, recordedAt: string): FakeSalePoint {
  return { price, recordedAt };
}

// ---------------------------------------------------------------------------
// #61 — Significant drop (pure)
// ---------------------------------------------------------------------------

describe('evaluateSignificantDrop (#61)', () => {
  it('fires on a ≥10% drop with old/new price, % drop and timestamps as evidence', () => {
    const result = evaluateSignificantDrop([
      point(100, daysAgo(2)),
      point(88, daysAgo(0)),
    ]);
    expect(result.fires).toBe(true);
    expect(result.oldPrice).toBe(100);
    expect(result.newPrice).toBe(88);
    expect(result.dropPct).toBe(12);
    expect(result.oldRecordedAt).toBe(daysAgo(2));
    expect(result.newRecordedAt).toBe(daysAgo(0));
    // Phase 2 validation reused for the evidence (not duplicated).
    expect(result.validation).not.toBeNull();
    expect(result.validation?.status).toBe('validated');
    expect(result.reason).toContain('12%');
  });

  it('does not fire below the threshold, and never fabricates a drop', () => {
    const result = evaluateSignificantDrop([
      point(100, daysAgo(2)),
      point(95, daysAgo(0)),
    ]);
    expect(result.fires).toBe(false);
    expect(result.dropPct).toBe(5);
  });

  it('does not fire on a single recorded point, and honours an explicit threshold', () => {
    expect(evaluateSignificantDrop([point(100, daysAgo(0))]).fires).toBe(false);
    expect(
      evaluateSignificantDrop(
        [point(100, daysAgo(2)), point(88, daysAgo(0))],
        15
      ).fires
    ).toBe(false);
    expect(
      evaluateSignificantDrop(
        [point(100, daysAgo(2)), point(88, daysAgo(0))],
        10
      ).fires
    ).toBe(true);
    expect(SIGNIFICANT_DROP_THRESHOLD_PCT).toBe(10);
  });

  it('flags the evidence when the drop is measured against a raised price', () => {
    // Rise ≥10% then a drop that stays above the pre-rise price:
    // the classic fake-discount shape — the drop fires (it is a
    // real recorded drop) but the validation says `flagged`.
    const result = evaluateSignificantDrop([
      point(80, daysAgo(10)),
      point(100, daysAgo(2)),
      point(88, daysAgo(0)),
    ]);
    expect(result.fires).toBe(true);
    expect(result.dropPct).toBe(12);
    expect(result.validation?.status).toBe('flagged');
    expect(result.reason).toMatch(/fake-discount/i);
  });
});

// ---------------------------------------------------------------------------
// #62 — Trend (pure)
// ---------------------------------------------------------------------------

describe('evaluateTrend (#62)', () => {
  it('fires on a sustained downward trend with window, points and direction', () => {
    const history = [100, 94, 88, 82, 76, 70].map((price, i) =>
      point(price, daysAgo(25 - i * 5))
    );
    const result = evaluateTrend(history);
    expect(result.fires).toBe(true);
    expect(result.direction).toBe('down');
    expect(result.changePct).toBe(-30);
    expect(result.points).toBe(6);
    expect(result.windowDays).toBe(30);
    expect(result.startPrice).toBe(100);
    expect(result.endPrice).toBe(70);
    expect(result.reason).toContain('6 recorded prices');
  });

  it('fires on a sustained upward trend the user should know about', () => {
    const history = [70, 76, 82, 88, 94, 100].map((price, i) =>
      point(price, daysAgo(25 - i * 5))
    );
    const result = evaluateTrend(history);
    expect(result.fires).toBe(true);
    expect(result.direction).toBe('up');
    expect(result.changePct).toBe(42.9);
  });

  it('does not fire on a flat series or a one-point wiggle', () => {
    const flat = [90, 90, 90, 90, 90, 90].map((price, i) =>
      point(price, daysAgo(25 - i * 5))
    );
    expect(evaluateTrend(flat).fires).toBe(false);
    const wiggle = [100, 98, 100, 99, 100, 97].map((price, i) =>
      point(price, daysAgo(25 - i * 5))
    );
    expect(evaluateTrend(wiggle).fires).toBe(false);
  });

  it('never presents a trend as confident on ≤4 points — it does not fire at all', () => {
    const thin = [100, 90, 80, 70].map((price, i) => point(price, daysAgo(15 - i * 5)));
    const result = evaluateTrend(thin);
    expect(result.fires).toBe(false);
    expect(result.limitedData).toBe(true);
    expect(result.reason).toMatch(/too little data/i);
  });

  it('says the trend is based on limited data at 5–6 points', () => {
    const history = [100, 92, 84, 76, 68].map((price, i) =>
      point(price, daysAgo(20 - i * 5))
    );
    const result = evaluateTrend(history);
    expect(result.fires).toBe(true);
    expect(result.reason).toMatch(/limited data/i);
  });
});

// ---------------------------------------------------------------------------
// #63 — Wishlist triggers (pure)
// ---------------------------------------------------------------------------

describe('evaluateWishlistItemTriggers (#63)', () => {
  const base = {
    productId: 'p1',
    targetPrice: 100,
    currentPrice: 90,
    history: [point(95, daysAgo(2)), point(90, daysAgo(0))],
    inStock: true,
    transitionAt: null as string | null,
  };

  it('fires a target-price hit naming the product trigger and evidence', () => {
    const triggers = evaluateWishlistItemTriggers(base);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].kind).toBe('price_drop');
    expect(triggers[0].evidence).toContain('$90.00');
    expect(triggers[0].evidence).toContain('$100.00');
  });

  it('fires back-in-stock ONLY on a recorded transition, never on merely being in stock', () => {
    expect(evaluateWishlistItemTriggers(base)).toHaveLength(1);
    const withTransition = evaluateWishlistItemTriggers({
      ...base,
      targetPrice: null,
      currentPrice: 120,
      transitionAt: daysAgo(0),
    });
    expect(withTransition).toHaveLength(1);
    expect(withTransition[0].kind).toBe('back_in_stock');
    expect(withTransition[0].evidence).toContain('out-of-stock → in-stock');
  });

  it('fires a significant drop for a wishlisted product', () => {
    const triggers = evaluateWishlistItemTriggers({
      ...base,
      targetPrice: null,
      currentPrice: 88,
      history: [point(100, daysAgo(2)), point(88, daysAgo(0))],
    });
    expect(triggers.some((t) => t.kind === 'significant_drop')).toBe(true);
  });

  it('fires nothing without recorded evidence', () => {
    expect(
      evaluateWishlistItemTriggers({
        ...base,
        targetPrice: null,
        currentPrice: null,
        history: [],
      })
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// #64 — Opportunity (pure, composite reused)
// ---------------------------------------------------------------------------

describe('evaluateOpportunityAlert (#64)', () => {
  it('fires only when the full composite qualifies', () => {
    const result = evaluateOpportunityAlert({
      currentPrice: 90,
      lowestPrice: 90,
      dataFreshness: daysAgo(1),
      history: [
        point(100, daysAgo(10)),
        point(95, daysAgo(5)),
        point(90, daysAgo(1)),
      ],
      inStock: true,
    });
    expect(result.fires).toBe(true);
    expect(result.evidence).toContain('$90.00');
    expect(result.missing).toHaveLength(0);
  });

  it('does not fire when any composite condition is unmet', () => {
    const base = {
      currentPrice: 90,
      lowestPrice: 90,
      dataFreshness: daysAgo(1),
      history: [
        point(100, daysAgo(10)),
        point(95, daysAgo(5)),
        point(90, daysAgo(1)),
      ],
      inStock: true,
    };
    // Stale price → no alert.
    expect(
      evaluateOpportunityAlert({ ...base, dataFreshness: daysAgo(30) }).fires
    ).toBe(false);
    // Out of stock → no alert.
    expect(evaluateOpportunityAlert({ ...base, inStock: false }).fires).toBe(false);
    // Far above the recorded low → no alert.
    expect(evaluateOpportunityAlert({ ...base, currentPrice: 120 }).fires).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stub Supabase client (Phase 0 pattern + from() call counting +
// insert().select().maybeSingle() for createAlert)
// ---------------------------------------------------------------------------

interface StubDb {
  client: AnySupabaseClient;
  inserts: Array<{ table: string; row: Row }>;
  updates: Array<{ table: string; patch: Row }>;
  fromCalls: Record<string, number>;
  tables: Record<string, Row[]>;
}

function createStubSupabase(tables: Record<string, Row[]>): StubDb {
  const inserts: StubDb['inserts'] = [];
  const updates: StubDb['updates'] = [];
  const fromCalls: Record<string, number> = {};
  const store: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(tables)) store[k] = [...v];

  const query = (table: string) => {
    fromCalls[table] = (fromCalls[table] ?? 0) + 1;
    let rows = [...(store[table] ?? [])];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      neq(col: string, val: unknown) {
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
        const rowWithId = { id: `id-${inserts.length + 1}`, ...row };
        inserts.push({ table, row });
        store[table] = [...(store[table] ?? []), rowWithId];
        const ret = {
          select() {
            return {
              maybeSingle: () =>
                Promise.resolve({ data: rowWithId, error: null }),
            };
          },
          then(
            onFulfilled?: (value: { data: null; error: null }) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) {
            return Promise.resolve({ data: null, error: null }).then(
              onFulfilled,
              onRejected
            );
          },
        };
        return ret;
      },
      update(patch: Row) {
        updates.push({ table, patch });
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
    fromCalls,
    tables: store,
  };
}

const PRODUCTS: Row[] = [
  { id: 'p1', name: 'Sony Headphones', slug: 'sony-headphones', data_freshness: daysAgo(1) },
  { id: 'p2', name: 'MacBook Air', slug: 'macbook-air', data_freshness: daysAgo(1) },
  { id: 'p3', name: 'Galaxy Phone', slug: 'galaxy-phone', data_freshness: daysAgo(1) },
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

function historyRow(productId: string, price: number, recordedAt: string, availability = 'in_stock'): Row {
  return { product_id: productId, price, availability, recorded_at: recordedAt };
}

function checkerDb(overrides: Record<string, Row[]>): StubDb {
  return createStubSupabase({
    alerts: [],
    products: PRODUCTS,
    price_history: [],
    merchant_products: [],
    price_alert_history: [],
    availability_history: [],
    deals: [],
    wishlist_items: [],
    notification_queue: [],
    user_settings: [settingsRow()],
    ...overrides,
  });
}

function queuedNotifications(db: StubDb): Row[] {
  return db.inserts
    .filter((i) => i.table === 'notification_queue')
    .map((i) => i.row);
}

// ---------------------------------------------------------------------------
// Checker: #61 / #62 / #64 new alert types
// ---------------------------------------------------------------------------

describe('checkPriceAlerts — significant-drop / trend / opportunity alerts', () => {
  it('#61: a significant-drop alert fires with old/new price, % drop and validation evidence', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'significant_drop', condition_value: 10 })],
      price_history: [
        historyRow('p1', 100, daysAgo(2)),
        historyRow('p1', 88, daysAgo(0)),
      ],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.checked).toBe(1);
    expect(result.triggered).toBe(1);
    expect(result.queued).toBe(1);
    const queued = queuedNotifications(db);
    expect(queued).toHaveLength(1);
    expect(queued[0].data).toMatchObject({
      alertType: 'significant_drop',
      oldPrice: 100,
      newPrice: 88,
      dropPct: 12,
      dropValidation: 'validated',
    });
    expect((queued[0].data as Row).targetPrice).toBeNull();
    expect(String(queued[0].subject)).toContain('12%');
  });

  it('#61: a drop below the threshold fires nothing', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'significant_drop', condition_value: 10 })],
      price_history: [
        historyRow('p1', 100, daysAgo(2)),
        historyRow('p1', 95, daysAgo(0)),
      ],
    });
    const result = await checkPriceAlerts(db.client);
    expect(result.triggered).toBe(0);
    expect(result.queued).toBe(0);
  });

  it('#62: a trend alert fires on a sustained recorded move, and not on ≤4 points', async () => {
    const trending = checkerDb({
      alerts: [alertRow({ alert_type: 'trend' })],
      price_history: [100, 94, 88, 82, 76, 70].map((price, i) =>
        historyRow('p1', price, daysAgo(25 - i * 5))
      ),
    });
    const fired = await checkPriceAlerts(trending.client);
    expect(fired.triggered).toBe(1);
    expect(fired.queued).toBe(1);
    expect(queuedNotifications(trending)[0].data).toMatchObject({
      alertType: 'trend',
      trendDirection: 'down',
      changePct: -30,
      trendPoints: 6,
    });

    const thin = checkerDb({
      alerts: [alertRow({ alert_type: 'trend' })],
      price_history: [100, 90, 80, 70].map((price, i) =>
        historyRow('p1', price, daysAgo(15 - i * 5))
      ),
    });
    const notFired = await checkPriceAlerts(thin.client);
    expect(notFired.triggered).toBe(0);
    expect(notFired.queued).toBe(0);
  });

  it('#64: an opportunity alert fires only when the composite qualifies', async () => {
    const qualifies = checkerDb({
      alerts: [alertRow({ alert_type: 'opportunity', condition_value: null })],
      price_history: [
        historyRow('p1', 100, daysAgo(10)),
        historyRow('p1', 95, daysAgo(5)),
        historyRow('p1', 90, daysAgo(1)),
      ],
    });
    const fired = await checkPriceAlerts(qualifies.client);
    expect(fired.triggered).toBe(1);
    expect(fired.queued).toBe(1);
    expect(queuedNotifications(qualifies)[0].data).toMatchObject({
      alertType: 'opportunity',
    });

    // Stale price → the composite cannot qualify → no alert.
    const stale = checkerDb({
      alerts: [alertRow({ alert_type: 'opportunity', condition_value: null })],
      products: [
        { id: 'p1', name: 'Sony Headphones', slug: 'sony-headphones', data_freshness: daysAgo(30) },
      ],
      price_history: [
        historyRow('p1', 100, daysAgo(10)),
        historyRow('p1', 95, daysAgo(5)),
        historyRow('p1', 90, daysAgo(1)),
      ],
    });
    const notFired = await checkPriceAlerts(stale.client);
    expect(notFired.triggered).toBe(0);
    expect(notFired.queued).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Checker: #67 back_in_stock transition (signed-in path)
// ---------------------------------------------------------------------------

describe('checkPriceAlerts — back_in_stock transition (#67)', () => {
  it('fires on a recorded out→in transition', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'back_in_stock', condition_value: null })],
      price_history: [historyRow('p1', 90, daysAgo(0), 'in_stock')],
      availability_history: [
        { product_id: 'p1', in_stock: true, recorded_at: daysAgo(0) },
        { product_id: 'p1', in_stock: false, recorded_at: daysAgo(2) },
      ],
    });
    const result = await checkPriceAlerts(db.client);
    expect(result.triggered).toBe(1);
    expect(result.queued).toBe(1);
    expect(queuedNotifications(db)[0].data).toMatchObject({
      alertType: 'back_in_stock',
    });
  });

  it('does NOT fire when the product was already in stock (no transition)', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'back_in_stock', condition_value: null })],
      price_history: [historyRow('p1', 90, daysAgo(0), 'in_stock')],
      availability_history: [
        { product_id: 'p1', in_stock: true, recorded_at: daysAgo(0) },
        { product_id: 'p1', in_stock: true, recorded_at: daysAgo(2) },
      ],
    });
    const result = await checkPriceAlerts(db.client);
    expect(result.triggered).toBe(0);
    expect(result.queued).toBe(0);
  });

  it('does NOT fire on a single availability row (previous state unknown)', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'back_in_stock', condition_value: null })],
      price_history: [
        historyRow('p1', 90, daysAgo(0), 'in_stock'),
        historyRow('p1', 90, daysAgo(2), 'in_stock'),
      ],
      availability_history: [
        { product_id: 'p1', in_stock: true, recorded_at: daysAgo(0) },
      ],
    });
    const result = await checkPriceAlerts(db.client);
    expect(result.triggered).toBe(0);
    expect(result.queued).toBe(0);
  });

  it('falls back to the two latest price_history rows when availability_history is empty', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'back_in_stock', condition_value: null })],
      price_history: [
        historyRow('p1', 90, daysAgo(0), 'in_stock'),
        historyRow('p1', 95, daysAgo(2), 'out_of_stock'),
      ],
      availability_history: [],
    });
    const result = await checkPriceAlerts(db.client);
    expect(result.triggered).toBe(1);
    expect(result.queued).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Checker: #69 batched deals (no N+1)
// ---------------------------------------------------------------------------

describe('checkPriceAlerts — batched deal check (#69)', () => {
  it('three deal alerts for three products issue exactly ONE deals query', async () => {
    const db = checkerDb({
      alerts: [
        alertRow({ id: 'a1', product_id: 'p1', alert_type: 'deal', condition_value: null }),
        alertRow({ id: 'a2', product_id: 'p2', alert_type: 'deal', condition_value: null }),
        alertRow({ id: 'a3', product_id: 'p3', alert_type: 'deal', condition_value: null }),
      ],
      deals: [
        { product_id: 'p1', active: true, deleted_at: null, end_at: iso(now + 30 * DAY) },
        { product_id: 'p2', active: true, deleted_at: null, end_at: iso(now + 30 * DAY) },
        { product_id: 'p3', active: true, deleted_at: null, end_at: iso(now + 30 * DAY) },
      ],
      price_history: [
        historyRow('p1', 90, daysAgo(0)),
        historyRow('p2', 800, daysAgo(0)),
        historyRow('p3', 500, daysAgo(0)),
      ],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.checked).toBe(3);
    expect(result.triggered).toBe(3);
    expect(result.queued).toBe(3);
    // The N+1 was one deals query per alert (3); the fix batches to one.
    expect(db.fromCalls['deals']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Checker: #63 wishlist phase
// ---------------------------------------------------------------------------

describe('checkPriceAlerts — wishlist alerts (#63)', () => {
  function wishlistDb(overrides: Record<string, Row[]>): StubDb {
    return checkerDb({
      wishlist_items: [
        {
          product_id: 'p1',
          target_price: 100,
          added_at: daysAgo(1),
          wishlists: { user_id: 'u1' },
        },
      ],
      price_history: [
        historyRow('p1', 95, daysAgo(2)),
        historyRow('p1', 90, daysAgo(0)),
      ],
      ...overrides,
    });
  }

  it('queues a target-price hit for a wishlisted product (and creates no stored alert)', async () => {
    const db = wishlistDb({});
    const result = await checkPriceAlerts(db.client);

    expect(result.wishlistChecked).toBe(1);
    expect(result.wishlistTriggered).toBe(1);
    expect(result.wishlistQueued).toBe(1);
    const queued = queuedNotifications(db);
    expect(queued).toHaveLength(1);
    expect(queued[0].data).toMatchObject({
      alertKind: 'wishlist',
      wishlistTrigger: 'price_drop',
      triggerKey: 'wishlist:price_drop:p1:90',
    });
    // No stored alert row is created by the wishlist phase.
    expect(db.inserts.filter((i) => i.table === 'alerts')).toHaveLength(0);
  });

  it('honours the master switch: price_alerts off → no wishlist notification', async () => {
    const db = wishlistDb({
      user_settings: [settingsRow({ price_alerts: false })],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.wishlistChecked).toBe(1);
    expect(result.wishlistTriggered).toBe(0);
    expect(result.wishlistQueued).toBe(0);
    expect(result.skippedOptedOut).toBe(1);
    expect(queuedNotifications(db)).toHaveLength(0);
  });

  it('never queues the same wishlist trigger twice (trigger-key dedupe)', async () => {
    const db = wishlistDb({
      notification_queue: [
        {
          user_id: 'u1',
          type: 'price_alert',
          channel: 'email',
          subject: 'Price drop on your wishlist: Sony Headphones is now $90.00',
          body: 'x',
          data: {
            productSlug: 'sony-headphones',
            triggerKey: 'wishlist:price_drop:p1:90',
          },
          created_at: daysAgo(0),
        },
      ],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.wishlistTriggered).toBe(0);
    expect(result.wishlistQueued).toBe(0);
    expect(result.skippedDuplicate).toBe(1);
    expect(queuedNotifications(db)).toHaveLength(0);
  });

  it('fires a wishlist back-in-stock alert only on a recorded transition', async () => {
    const db = checkerDb({
      wishlist_items: [
        {
          product_id: 'p1',
          target_price: null,
          added_at: daysAgo(1),
          wishlists: { user_id: 'u1' },
        },
      ],
      price_history: [historyRow('p1', 120, daysAgo(0), 'in_stock')],
      availability_history: [
        { product_id: 'p1', in_stock: true, recorded_at: daysAgo(0) },
        { product_id: 'p1', in_stock: false, recorded_at: daysAgo(3) },
      ],
    });
    const result = await checkPriceAlerts(db.client);
    expect(result.wishlistTriggered).toBe(1);
    expect(result.wishlistQueued).toBe(1);
    expect(queuedNotifications(db)[0].data).toMatchObject({
      wishlistTrigger: 'back_in_stock',
    });
  });
});

// ---------------------------------------------------------------------------
// #67 — guest helper: transition is the trigger
// ---------------------------------------------------------------------------

describe('shouldTriggerGuestAlert — back_in_stock transition (#67)', () => {
  const alert = {
    alertType: 'back_in_stock' as const,
    targetPrice: null,
    lastTriggeredPrice: null,
    lastTriggeredAt: null,
  };

  it('fires on a recorded transition', () => {
    expect(
      shouldTriggerGuestAlert(alert, {
        price: 999,
        backInStock: true,
        backInStockTransition: true,
        hasActiveDeal: false,
      })
    ).toBe(true);
  });

  it('does NOT fire when in stock but no transition was recorded', () => {
    expect(
      shouldTriggerGuestAlert(alert, {
        price: 999,
        backInStock: true,
        backInStockTransition: false,
        hasActiveDeal: false,
      })
    ).toBe(false);
    // No transition field at all (old callers) → no fire either.
    expect(
      shouldTriggerGuestAlert(alert, {
        price: 999,
        backInStock: true,
        hasActiveDeal: false,
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #68 — duplicate alert creation
// ---------------------------------------------------------------------------

describe('createAlert — duplicate creation check (#68)', () => {
  it('second identical creation attempt creates no duplicate row', async () => {
    const db = createStubSupabase({
      alerts: [],
      products: PRODUCTS,
    });
    const first = await createAlert(db.client, 'u1', {
      productId: 'p1',
      alertType: 'price_drop',
      conditionValue: 100,
      channel: 'email',
    });
    expect(first).not.toBeNull();
    expect(db.inserts.filter((i) => i.table === 'alerts')).toHaveLength(1);

    const second = await createAlert(db.client, 'u1', {
      productId: 'p1',
      alertType: 'price_drop',
      conditionValue: 100,
      channel: 'email',
    });
    expect(second).not.toBeNull();
    expect(second?.id).toBe(first?.id);
    expect(db.inserts.filter((i) => i.table === 'alerts')).toHaveLength(1);
  });

  it('a different target price is a different trigger and IS created', async () => {
    const db = createStubSupabase({ alerts: [] });
    await createAlert(db.client, 'u1', {
      productId: 'p1',
      alertType: 'price_drop',
      conditionValue: 100,
    });
    const other = await createAlert(db.client, 'u1', {
      productId: 'p1',
      alertType: 'price_drop',
      conditionValue: 80,
    });
    expect(other).not.toBeNull();
    expect(db.inserts.filter((i) => i.table === 'alerts')).toHaveLength(2);
  });

  it('an inactive twin does not block a fresh create', async () => {
    const db = createStubSupabase({
      alerts: [
        {
          id: 'old',
          user_id: 'u1',
          product_id: 'p1',
          alert_type: 'price_drop',
          condition_value: 100,
          channel: 'email',
          active: false,
          last_triggered_at: null,
          trigger_count: 0,
          created_at: daysAgo(5),
          updated_at: daysAgo(5),
        },
      ],
    });
    const created = await createAlert(db.client, 'u1', {
      productId: 'p1',
      alertType: 'price_drop',
      conditionValue: 100,
    });
    expect(created).not.toBeNull();
    expect(created?.id).not.toBe('old');
    expect(db.inserts.filter((i) => i.table === 'alerts')).toHaveLength(1);
  });
});
