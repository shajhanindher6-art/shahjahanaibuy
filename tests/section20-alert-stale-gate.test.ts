/**
 * Section 20 — stale-price alert gate tests (audit P0-3 / §12 #81).
 *
 * This is the slice the other three Section 20 test files explicitly
 * left open: tests/section20-quality-gtin-freshness.test.ts covers
 * only the freshness *helpers* (STALE_PRICE_DAYS, isPriceStale,
 * getFreshnessStatus) and notes the alert-checker wiring is the P0
 * worker's item — but no test file ever asserted it. There is no
 * tests/section20-p0-honesty.test.ts in the tree, and a repo-wide
 * grep finds zero test references to `alertPriceFreshness` or
 * `skippedStale` (the Section 19 alert-intelligence file tests the
 * opportunity composite's own freshness rule, not this gate).
 *
 * Covers, against a mocked Supabase client (no DB, no network):
 * - alertPriceFreshness (services/alert-checker.ts) — fresh / stale /
 *   unknown, including the 7-day boundary (STALE_PRICE_DAYS = 7).
 * - alertUnknownAgeNote — the qualifier appended to unknown-age
 *   "is now" bodies.
 * - checkPriceAlerts stale gate, end to end per alert type:
 *   - price_drop on an 11-day-old price is SUPPRESSED (skippedStale
 *     1, nothing queued, no trigger record, no last_triggered_at
 *     update); fresh fires; exactly 7 days fires (boundary).
 *   - price_drop with no recorded check date (merchant-listing
 *     fallback) fires but the body carries the unknown-age note.
 *   - back_in_stock on a stale transition is suppressed; fresh
 *     transition fires.
 *   - significant_drop whose newest point is stale is suppressed.
 *   - deal alerts are NOT gated by this gate (they make no
 *     "is now" claim) — a deal still fires on a stale price.
 *   - trend alerts are NOT suppressed either, but a stale latest
 *     price is qualified in the body ("may be out of date").
 *   - wishlist price_drop / back_in_stock triggers on stale
 *     records are suppressed the same way (skippedStale).
 *
 * Deliberately NOT covered here (covered elsewhere, not duplicated):
 * - Platform-status relabel (recorded-prices-only / tag-only):
 *   tests/platform-status.test.ts (§12 #51).
 * - Freshness helpers: tests/section20-quality-gtin-freshness.test.ts
 *   and tests/section19-price-freshness-gate.test.ts.
 * - The alert types' own firing logic (significant-drop / trend /
 *   opportunity / back-in-stock transition): tests/section19-phase6-
 *   alert-intelligence.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  alertPriceFreshness,
  alertUnknownAgeNote,
  checkPriceAlerts,
} from '@/services/alert-checker';
import { STALE_PRICE_DAYS } from '@/lib/price-freshness';
import type { AnySupabaseClient } from '@/lib/supabase/types';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const daysAgo = (d: number) => iso(now - d * DAY);

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// alertPriceFreshness — pure unit tests
// ---------------------------------------------------------------------------

describe('alertPriceFreshness', () => {
  it('STALE_PRICE_DAYS is 7', () => {
    expect(STALE_PRICE_DAYS).toBe(7);
  });

  it('fresh: recorded today and exactly 7 days ago', () => {
    expect(alertPriceFreshness(daysAgo(0))).toBe('fresh');
    expect(alertPriceFreshness(daysAgo(3))).toBe('fresh');
    // Boundary: age > 7 days is stale, so exactly 7 days is fresh.
    expect(alertPriceFreshness(daysAgo(7))).toBe('fresh');
  });

  it('stale: 8 days and 11 days ago (the live catalog age)', () => {
    expect(alertPriceFreshness(daysAgo(8))).toBe('stale');
    expect(alertPriceFreshness(daysAgo(11))).toBe('stale');
    expect(alertPriceFreshness(daysAgo(30))).toBe('stale');
  });

  it('unknown: null / undefined / garbage carry no check date', () => {
    expect(alertPriceFreshness(null)).toBe('unknown');
    expect(alertPriceFreshness(undefined)).toBe('unknown');
    expect(alertPriceFreshness('not-a-date')).toBe('unknown');
    expect(alertPriceFreshness('')).toBe('unknown');
  });

  it('a future check date is fresh, never stale', () => {
    expect(alertPriceFreshness(iso(now + DAY))).toBe('fresh');
  });

  it('alertUnknownAgeNote warns the price may be out of date', () => {
    expect(alertUnknownAgeNote()).toContain('Price age unknown');
    expect(alertUnknownAgeNote()).toContain('may be out of date');
  });
});

// ---------------------------------------------------------------------------
// Minimal chainable fake Supabase client (same pattern as the Section 19
// alert-intelligence tests, trimmed to what checkPriceAlerts reads)
// ---------------------------------------------------------------------------

interface StubDb {
  client: AnySupabaseClient;
  inserts: Array<{ table: string; row: Row }>;
  updates: Array<{ table: string; patch: Row }>;
}

function createStubSupabase(tables: Record<string, Row[]>): StubDb {
  const inserts: StubDb['inserts'] = [];
  const updates: StubDb['updates'] = [];
  const store: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(tables)) store[k] = [...v];

  const query = (table: string) => {
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
          return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
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
        return {
          select() {
            return { maybeSingle: () => Promise.resolve({ data: rowWithId, error: null }) };
          },
          then(
            onFulfilled?: (value: { data: null; error: null }) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) {
            return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
          },
        };
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
  };
}

const PRODUCTS: Row[] = [
  { id: 'p1', name: 'Sony Headphones', slug: 'sony-headphones', data_freshness: daysAgo(1) },
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
  return db.inserts.filter((i) => i.table === 'notification_queue').map((i) => i.row);
}

function triggerRecords(db: StubDb): Row[] {
  return db.inserts.filter((i) => i.table === 'price_alert_history').map((i) => i.row);
}

function alertUpdates(db: StubDb): Row[] {
  return db.updates.filter((u) => u.table === 'alerts').map((u) => u.patch);
}

// ---------------------------------------------------------------------------
// checkPriceAlerts — price_drop gate
// ---------------------------------------------------------------------------

describe('checkPriceAlerts — price_drop stale gate (§12 #81)', () => {
  it('SUPPRESSES a price_drop on an 11-day-old price: no "is now $Y!" from stale data', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'price_drop', condition_value: 100 })],
      price_history: [historyRow('p1', 90, daysAgo(11))],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.checked).toBe(1);
    expect(result.triggered).toBe(0);
    expect(result.queued).toBe(0);
    expect(result.skippedStale).toBe(1);
    // Suppression is total: nothing queued, no trigger record, and
    // last_triggered_at is NOT advanced (the alert stays armed).
    expect(queuedNotifications(db)).toHaveLength(0);
    expect(triggerRecords(db)).toHaveLength(0);
    expect(alertUpdates(db)).toHaveLength(0);
  });

  it('fires a price_drop on a fresh price (recorded today)', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'price_drop', condition_value: 100 })],
      price_history: [historyRow('p1', 90, daysAgo(0))],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.triggered).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.skippedStale).toBe(0);
    expect(queuedNotifications(db)).toHaveLength(1);
    expect(String(queuedNotifications(db)[0].subject)).toContain('is now $90.00!');
    expect(triggerRecords(db)).toHaveLength(1);
  });

  it('fires a price_drop recorded exactly 7 days ago (boundary: stale is > 7 days)', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'price_drop', condition_value: 100 })],
      price_history: [historyRow('p1', 90, daysAgo(7))],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.triggered).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.skippedStale).toBe(0);
  });

  it('suppresses a price_drop at 8 days (one day past the boundary)', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'price_drop', condition_value: 100 })],
      price_history: [historyRow('p1', 90, daysAgo(8))],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.triggered).toBe(0);
    expect(result.skippedStale).toBe(1);
    expect(queuedNotifications(db)).toHaveLength(0);
  });

  it('fires on an unknown-age price (merchant-listing fallback) but qualifies the body', async () => {
    // No price_history at all: the current price comes from the
    // merchant listing, which carries no check date (recordedAt
    // null) — unknown age does NOT suppress, but the body must
    // never read as a confirmed current price.
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'price_drop', condition_value: 100 })],
      merchant_products: [
        { product_id: 'p1', price: 90, in_stock: true, deleted_at: null },
      ],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.triggered).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.skippedStale).toBe(0);
    expect(String(queuedNotifications(db)[0].body)).toContain('Price age unknown');
    expect(String(queuedNotifications(db)[0].body)).toContain('may be out of date');
  });
});

// ---------------------------------------------------------------------------
// checkPriceAlerts — back_in_stock + significant_drop gates
// ---------------------------------------------------------------------------

describe('checkPriceAlerts — back_in_stock / significant_drop stale gates (§12 #81)', () => {
  it('SUPPRESSES a back_in_stock alert whose transition is 11 days old', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'back_in_stock', condition_value: null })],
      price_history: [historyRow('p1', 90, daysAgo(11), 'in_stock')],
      availability_history: [
        { product_id: 'p1', in_stock: true, recorded_at: daysAgo(11) },
        { product_id: 'p1', in_stock: false, recorded_at: daysAgo(13) },
      ],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.triggered).toBe(0);
    expect(result.queued).toBe(0);
    expect(result.skippedStale).toBe(1);
    expect(queuedNotifications(db)).toHaveLength(0);
    expect(triggerRecords(db)).toHaveLength(0);
  });

  it('fires a back_in_stock alert on a fresh (today) transition', async () => {
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
    expect(result.skippedStale).toBe(0);
    expect(queuedNotifications(db)[0].data).toMatchObject({ alertType: 'back_in_stock' });
  });

  it('SUPPRESSES a significant_drop whose newest point is 11 days old', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'significant_drop', condition_value: 10 })],
      price_history: [
        historyRow('p1', 100, daysAgo(13)),
        historyRow('p1', 85, daysAgo(11)),
      ],
    });
    const result = await checkPriceAlerts(db.client);

    // 15% drop clears the 10% threshold, so without the gate this
    // would fire with an "is now $85.00!" subject on 11-day-old data.
    expect(result.triggered).toBe(0);
    expect(result.queued).toBe(0);
    expect(result.skippedStale).toBe(1);
    expect(queuedNotifications(db)).toHaveLength(0);
  });

  it('fires a significant_drop on fresh points', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'significant_drop', condition_value: 10 })],
      price_history: [
        historyRow('p1', 100, daysAgo(2)),
        historyRow('p1', 85, daysAgo(0)),
      ],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.triggered).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.skippedStale).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkPriceAlerts — types the gate deliberately does NOT suppress
// ---------------------------------------------------------------------------

describe('checkPriceAlerts — deal / trend are not suppressed by the stale gate', () => {
  it('a deal alert still fires on a stale price (it makes no "is now" claim)', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'deal', condition_value: null })],
      price_history: [historyRow('p1', 90, daysAgo(11))],
      deals: [
        { product_id: 'p1', active: true, deleted_at: null, end_at: daysAgo(-30) },
      ],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.triggered).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.skippedStale).toBe(0);
    // The deal branch sets no alertType in queueExtra (unlike the
    // typed branches), so assert on the subject instead.
    expect(String(queuedNotifications(db)[0].subject)).toContain('New deal: Sony Headphones');
  });

  it('a trend alert still fires on stale points, but the body qualifies the age', async () => {
    const db = checkerDb({
      alerts: [alertRow({ alert_type: 'trend', condition_value: null })],
      price_history: [100, 94, 88, 82, 76, 70].map((price, i) =>
        historyRow('p1', price, daysAgo(35 - i * 5))
      ),
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.triggered).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.skippedStale).toBe(0);
    // Latest point is 10 days old: the body says so instead of
    // presenting the trend as current.
    expect(String(queuedNotifications(db)[0].body)).toContain('10 days ago');
    expect(String(queuedNotifications(db)[0].body)).toContain('may be out of date');
  });
});

// ---------------------------------------------------------------------------
// checkPriceAlerts — wishlist phase gate
// ---------------------------------------------------------------------------

describe('checkPriceAlerts — wishlist stale gate (§12 #81)', () => {
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
      price_history: [historyRow('p1', 90, daysAgo(11))],
      ...overrides,
    });
  }

  it('SUPPRESSES a wishlist price_drop on an 11-day-old price', async () => {
    const db = wishlistDb({});
    const result = await checkPriceAlerts(db.client);

    expect(result.wishlistChecked).toBe(1);
    expect(result.wishlistTriggered).toBe(0);
    expect(result.wishlistQueued).toBe(0);
    expect(result.skippedStale).toBe(1);
    expect(queuedNotifications(db)).toHaveLength(0);
  });

  it('fires a wishlist price_drop on a fresh price', async () => {
    const db = wishlistDb({
      price_history: [
        historyRow('p1', 95, daysAgo(2)),
        historyRow('p1', 90, daysAgo(0)),
      ],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.wishlistChecked).toBe(1);
    expect(result.wishlistTriggered).toBe(1);
    expect(result.wishlistQueued).toBe(1);
    expect(result.skippedStale).toBe(0);
    expect(queuedNotifications(db)).toHaveLength(1);
  });

  it('SUPPRESSES a wishlist back_in_stock on a stale transition', async () => {
    const db = checkerDb({
      wishlist_items: [
        {
          product_id: 'p1',
          target_price: null,
          added_at: daysAgo(1),
          wishlists: { user_id: 'u1' },
        },
      ],
      price_history: [historyRow('p1', 120, daysAgo(11), 'in_stock')],
      availability_history: [
        { product_id: 'p1', in_stock: true, recorded_at: daysAgo(11) },
        { product_id: 'p1', in_stock: false, recorded_at: daysAgo(13) },
      ],
    });
    const result = await checkPriceAlerts(db.client);

    expect(result.wishlistChecked).toBe(1);
    expect(result.wishlistTriggered).toBe(0);
    expect(result.wishlistQueued).toBe(0);
    expect(result.skippedStale).toBe(1);
    expect(queuedNotifications(db)).toHaveLength(0);
  });
});
