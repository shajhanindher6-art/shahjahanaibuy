/**
 * FINAL 100% Product & Real Data Completion — Worker W3 regression tests.
 *
 * Covers, with no DB and no network:
 * - F-P1-32/F-P1-33: isDuplicatePricePoint (change-only dedupe) +
 *   recordProcessorPricePoint (quality-writer routing for both
 *   processors.ts inserts: source/observed_at/suspicious/dedupe)
 * - F-P1-35: recordIntakePriceHistory (intake approve writes history)
 * - F-P1-36: the unified 5-point + freshness gate (volatility +
 *   explorer share it; the lib-level cases live here, the row/summary
 *   cases in tests/volatility-ranking.test.ts and
 *   tests/price-history-explorer.test.ts)
 * - F-P1-37: getPriceHistory staleness metadata + per-row source
 * - F-P1-38: getHistoryProvenance seed-origin detection
 * - F-P2-22/F-P2-23: gateTrendStats (chart + compare share it)
 * - F-P2-24: retention policy — a plan never deletes
 * - F-P1-13/F-P1-14: resolveIntakeAvailability / resolveIntakeDataFreshness
 * - F-P1-05: getProductAttribution + recordProductAttribution
 */

import { describe, expect, it } from 'vitest';
import {
  assessHistoryGate,
  gateTrendStats,
  getHistoryProvenance,
  HISTORY_MIN_POINTS,
  SEED_HISTORY_CUTOFF_ISO,
} from '@/lib/price-history-gates';
import {
  isDuplicatePricePoint,
  insertPriceHistoryRow,
} from '@/services/price-history-quality';
import { getPriceHistory } from '@/services/price-history';
import { recordProcessorPricePoint } from '@/lib/workers/processors';
import { recordIntakePriceHistory } from '@/services/intake-price-history';
import {
  resolveIntakeAvailability,
  resolveIntakeDataFreshness,
} from '@/services/intake-evidence';
import {
  getProductAttribution,
  recordProductAttribution,
} from '@/services/product-attribution';
import {
  getPriceHistoryRetentionPolicy,
  planPriceHistoryArchival,
} from '@/services/price-history-retention';
import type { AnySupabaseClient } from '@/lib/supabase/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-13T12:00:00.000Z');

function dayAgo(n: number, from: Date = NOW): string {
  return new Date(from.getTime() - n * DAY_MS).toISOString();
}

function points(prices: number[], latestAgeDays: number, stepDays = 7) {
  return prices.map((price, i) => ({
    price,
    recordedAt: dayAgo(latestAgeDays + (prices.length - 1 - i) * stepDays),
  }));
}

// ---------------------------------------------------------------------------
// Minimal chainable fake Supabase client
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface FakeOptions {
  tables?: Record<string, Row[]>;
  /** Fail the FIRST select whose columns contain `match` with this code. */
  failFirstSelectWith?: { match: string; code: string };
}

function fakeClient(opts: FakeOptions = {}) {
  const tables: Record<string, Row[]> = opts.tables ?? {};
  const inserts: Array<{ table: string; row: Row }> = [];
  const upserts: Array<{ table: string; row: Row }> = [];
  let selectCalls = 0;

  class Query {
    private table: string;
    private columns = '';
    private filters: Array<(row: Row) => boolean> = [];
    private sortKey: string | null = null;
    private sortAsc = true;
    private limitN: number | null = null;

    constructor(table: string) {
      this.table = table;
    }
    select(columns: string) {
      this.columns = columns;
      return this;
    }
    eq(col: string, value: unknown) {
      this.filters.push((row) => row[col] === value);
      return this;
    }
    is(col: string, value: unknown) {
      this.filters.push((row) => (value === null ? row[col] == null : row[col] === value));
      return this;
    }
    in(col: string, values: unknown[]) {
      this.filters.push((row) => values.includes(row[col]));
      return this;
    }
    order(col: string, { ascending }: { ascending: boolean }) {
      this.sortKey = col;
      this.sortAsc = ascending;
      return this;
    }
    limit(n: number) {
      this.limitN = n;
      return this;
    }
    async maybeSingle() {
      const { data } = await this.run();
      return { data: (data as Row[] | null)?.[0] ?? null, error: null };
    }
    async insert(row: Row) {
      inserts.push({ table: this.table, row });
      return { data: null, error: null };
    }
    async upsert(row: Row, _opts?: unknown) {
      upserts.push({ table: this.table, row });
      return { data: null, error: null };
    }
    then<TResult1 = { data: Row[] | null; error: { code?: string; message: string } | null }>(
      resolve: (value: { data: Row[] | null; error: { code?: string; message: string } | null }) => TResult1
    ): Promise<TResult1> {
      return this.run().then(resolve);
    }
    private async run() {
      selectCalls += 1;
      const fail = opts.failFirstSelectWith;
      if (fail && selectCalls === 1 && this.columns.includes(fail.match)) {
        return {
          data: null,
          error: { code: fail.code, message: 'column does not exist' },
        };
      }
      // Fail EVERY select whose columns contain the match when the
      // match is a provenance column and the table predates it:
      // the fake models a pre-057/pre-045 table via failMatch.
      let rows = [...(tables[this.table] ?? [])];
      for (const f of this.filters) rows = rows.filter(f);
      if (this.sortKey) {
        const key = this.sortKey;
        rows.sort((a, b) => {
          const av = String(a[key] ?? '');
          const bv = String(b[key] ?? '');
          return this.sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
      return { data: rows, error: null };
    }
  }

  const client = {
    inserts,
    upserts,
    from(table: string) {
      return new Query(table);
    },
  };
  return client as unknown as AnySupabaseClient & {
    inserts: Array<{ table: string; row: Row }>;
    upserts: Array<{ table: string; row: Row }>;
  };
}

// ---------------------------------------------------------------------------
// F-P1-32 / F-P1-33 — dedupe + quality-writer routing
// ---------------------------------------------------------------------------

describe('isDuplicatePricePoint (F-P1-32/F-P1-33)', () => {
  it('same price + same availability is a duplicate', () => {
    expect(isDuplicatePricePoint({ price: 999, availability: 'in_stock' }, 999, 'in_stock')).toBe(true);
    // Stored prices arrive as strings from PostgREST.
    expect(isDuplicatePricePoint({ price: '999', availability: 'in_stock' }, 999, 'in_stock')).toBe(true);
  });

  it('a changed price or a changed availability is a new observation', () => {
    expect(isDuplicatePricePoint({ price: 999, availability: 'in_stock' }, 989, 'in_stock')).toBe(false);
    expect(isDuplicatePricePoint({ price: 999, availability: 'in_stock' }, 999, 'out_of_stock')).toBe(false);
  });

  it('no latest row is never a duplicate (first observation always records)', () => {
    expect(isDuplicatePricePoint(null, 999, 'in_stock')).toBe(false);
    expect(isDuplicatePricePoint(undefined, 999, 'in_stock')).toBe(false);
  });
});

describe('recordProcessorPricePoint (F-P1-33)', () => {
  it('writes through the quality writer with source, observed_at and flag', async () => {
    const client = fakeClient({ tables: { price_history: [] } });
    const result = await recordProcessorPricePoint(client, {
      productId: 'p1',
      retailerId: 'r1',
      price: 90,
      currency: 'USD',
      availability: 'in_stock',
      source: 'merchant-feed',
      observedAt: '2026-11-13T10:00:00.000Z',
    });
    expect(result.recorded).toBe(true);
    expect(result.duplicateSkipped).toBe(false);
    expect(client.inserts).toHaveLength(1);
    expect(client.inserts[0].row).toMatchObject({
      product_id: 'p1',
      price: 90,
      source: 'merchant-feed',
      observed_at: '2026-11-13T10:00:00.000Z',
      suspicious_change: false,
    });
  });

  it('skips an unchanged re-record instead of inserting', async () => {
    const client = fakeClient({
      tables: {
        price_history: [
          {
            product_id: 'p1',
            retailer_id: 'r1',
            price: 90,
            availability: 'in_stock',
            recorded_at: dayAgo(1),
          },
        ],
      },
    });
    const result = await recordProcessorPricePoint(client, {
      productId: 'p1',
      retailerId: 'r1',
      price: 90,
      currency: 'USD',
      availability: 'in_stock',
      source: 'merchant-feed',
      observedAt: '2026-11-13T10:00:00.000Z',
    });
    expect(result.recorded).toBe(false);
    expect(result.duplicateSkipped).toBe(true);
    expect(client.inserts).toHaveLength(0);
  });

  it('rejects an invalid price instead of inserting it', async () => {
    const client = fakeClient({ tables: { price_history: [] } });
    const result = await recordProcessorPricePoint(client, {
      productId: 'p1',
      retailerId: 'r1',
      price: Number.NaN,
      currency: 'USD',
    });
    expect(result.recorded).toBe(false);
    expect(result.error).toMatch(/Invalid price/);
    expect(client.inserts).toHaveLength(0);
  });

  it('defaults availability to unknown, never in_stock', async () => {
    const client = fakeClient({ tables: { price_history: [] } });
    await recordProcessorPricePoint(client, {
      productId: 'p1',
      retailerId: 'r1',
      price: 90,
      currency: 'USD',
      source: null,
      observedAt: null,
    });
    expect(client.inserts[0].row.availability).toBe('unknown');
    expect(client.inserts[0].row.source).toBeNull();
    expect(client.inserts[0].row.observed_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F-P1-36 / F-P2-22 / F-P2-23 — the unified gate
// ---------------------------------------------------------------------------

describe('assessHistoryGate (F-P1-36)', () => {
  it('the unified minimum is 5 recorded points', () => {
    expect(HISTORY_MIN_POINTS).toBe(5);
  });

  it('5 fresh points clear the gate', () => {
    const gate = assessHistoryGate(points([100, 101, 99, 100, 100], 1), NOW);
    expect(gate.gated).toBe(false);
    expect(gate.sufficient).toBe(true);
    expect(gate.fresh).toBe(true);
    expect(gate.reason).toBeNull();
  });

  it('4 fresh points are gated — the live seed shape draws no verdict', () => {
    const gate = assessHistoryGate(points([1048.95, 1018.98, 999, 999], 1), NOW);
    expect(gate.gated).toBe(true);
    expect(gate.reasonCode).toBe('not-enough-points');
    expect(gate.reason).toMatch(/4 of 5 recorded points/);
  });

  it('5 stale points are gated, with the age in the reason', () => {
    const gate = assessHistoryGate(points([100, 101, 99, 100, 100], 11), NOW);
    expect(gate.gated).toBe(true);
    expect(gate.reasonCode).toBe('stale');
    expect(gate.ageDays).toBe(11);
  });

  it('no points are gated, never treated as fresh', () => {
    const gate = assessHistoryGate([], NOW);
    expect(gate.gated).toBe(true);
    expect(gate.fresh).toBe(false);
  });
});

describe('gateTrendStats (F-P2-22/F-P2-23)', () => {
  it('returns null stats below 5 points — a 1-point "trend" is not a trend', () => {
    const { stats, gate } = gateTrendStats(points([899], 0), NOW);
    expect(stats).toBeNull();
    expect(gate.gated).toBe(true);
  });

  it('returns stats for 5 fresh points', () => {
    const { stats, gate } = gateTrendStats(points([100, 102, 98, 100, 101], 1), NOW);
    expect(gate.gated).toBe(false);
    expect(stats).not.toBeNull();
    expect(stats?.pointCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// F-P1-38 — seed provenance
// ---------------------------------------------------------------------------

describe('getHistoryProvenance (F-P1-38)', () => {
  it('labels the 057 backfill cutoff', () => {
    expect(SEED_HISTORY_CUTOFF_ISO).toBe('2026-11-03T00:00:00.000Z');
  });

  it('source=seed rows are seed-origin', () => {
    const prov = getHistoryProvenance([
      { price: 1048.95, recordedAt: '2026-10-03T00:00:00.000Z', source: 'seed' },
      { price: 999, recordedAt: '2026-11-02T00:00:00.000Z', source: 'seed' },
    ]);
    expect(prov.origin).toBe('seed');
    expect(prov.label).toMatch(/Seed demo history/);
  });

  it('unattributed rows before the cutoff are seed-origin (the 057 rule)', () => {
    const prov = getHistoryProvenance([
      { price: 1048.95, recordedAt: '2026-10-03T00:00:00.000Z', source: null },
      { price: 999, recordedAt: '2026-11-02T00:00:00.000Z' },
    ]);
    expect(prov.origin).toBe('seed');
  });

  it('unattributed rows after the cutoff are unknown — never guessed as seed', () => {
    const prov = getHistoryProvenance([
      { price: 100, recordedAt: '2026-11-10T00:00:00.000Z', source: null },
    ]);
    expect(prov.origin).toBe('unknown');
    expect(prov.label).toMatch(/no recorded source/);
  });

  it('live sources are live, with no label', () => {
    const prov = getHistoryProvenance([
      { price: 100, recordedAt: '2026-11-12T00:00:00.000Z', source: 'merchant-feed' },
      { price: 101, recordedAt: '2026-11-13T00:00:00.000Z', source: 'ebay-browse-api' },
    ]);
    expect(prov.origin).toBe('live');
    expect(prov.label).toBeNull();
  });

  it('seed + live points are mixed, and the label says how many are seed', () => {
    const prov = getHistoryProvenance([
      { price: 1048.95, recordedAt: '2026-10-03T00:00:00.000Z', source: 'seed' },
      { price: 100, recordedAt: '2026-11-12T00:00:00.000Z', source: 'live' },
    ]);
    expect(prov.origin).toBe('mixed');
    expect(prov.label).toMatch(/1 of 2 recorded points are seed/);
  });
});

// ---------------------------------------------------------------------------
// F-P1-37 — getPriceHistory staleness metadata
// ---------------------------------------------------------------------------

describe('getPriceHistory (F-P1-37)', () => {
  it('attaches freshness metadata and per-row source + staleness', async () => {
    const old = new Date(Date.now() - 20 * DAY_MS).toISOString();
    const older = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const client = fakeClient({
      tables: {
        price_history: [
          {
            id: 'h2',
            product_id: 'p1',
            retailer_id: 'r1',
            price: 999,
            currency: 'USD',
            availability: 'in_stock',
            url: null,
            recorded_at: old,
            source: 'seed',
            observed_at: old,
            suspicious_change: false,
          },
          {
            id: 'h1',
            product_id: 'p1',
            retailer_id: 'r1',
            price: 999,
            currency: 'USD',
            availability: 'in_stock',
            url: null,
            recorded_at: older,
            source: 'seed',
            observed_at: older,
            suspicious_change: false,
          },
        ],
      },
    });
    const result = await getPriceHistory(client, 'p1');
    expect(result.history).toHaveLength(2);
    expect(result.freshness.status).toBe('stale');
    expect(result.freshness.stale).toBe(true);
    expect(result.freshness.ageDays).toBe(20);
    expect(result.history[0].source).toBe('seed');
    expect(result.history[0].isStale).toBe(true);
    expect(result.history[0].ageDays).toBe(20);
    // Last two points identical: flat series, not a $0 "change" alone.
    expect(result.priceChange).toBe(0);
    expect(result.noMovement).toBe(true);
  });

  it('retries without the 057 columns on 42703 and reports source null, never guessed', async () => {
    const recent = new Date(Date.now() - 1 * DAY_MS).toISOString();
    const client = fakeClient({
      tables: {
        price_history: [
          {
            id: 'h1',
            product_id: 'p1',
            retailer_id: 'r1',
            price: 999,
            currency: 'USD',
            availability: 'in_stock',
            url: null,
            recorded_at: recent,
          },
        ],
      },
      failFirstSelectWith: { match: 'source', code: '42703' },
    });
    const result = await getPriceHistory(client, 'p1');
    expect(result.history).toHaveLength(1);
    expect(result.history[0].source).toBeNull();
    expect(result.freshness.status).toBe('fresh');
    expect(result.noMovement).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F-P1-35 — intake history
// ---------------------------------------------------------------------------

describe('recordIntakePriceHistory (F-P1-35)', () => {
  const merchantRow = { id: 'm1', slug: 'amazon' };
  const retailerRow = { id: 'r1', slug: 'amazon' };

  it('records a manual-intake price with source attribution and unknown availability', async () => {
    const client = fakeClient({
      tables: {
        merchants: [merchantRow],
        retailers: [retailerRow],
        price_history: [],
      },
    });
    const result = await recordIntakePriceHistory(client, {
      productId: 'p1',
      merchantId: 'm1',
      price: 999,
      currencyCode: 'USD',
      source: 'manual-intake',
      observedAt: null,
    });
    expect(result.recorded).toBe(true);
    expect(client.inserts).toHaveLength(1);
    expect(client.inserts[0].row).toMatchObject({
      product_id: 'p1',
      retailer_id: 'r1',
      price: 999,
      currency: 'USD',
      availability: 'unknown',
      source: 'manual-intake',
      observed_at: null,
    });
  });

  it('records an eBay preview price with the preview fetch time as observed_at', async () => {
    const client = fakeClient({
      tables: {
        merchants: [merchantRow],
        retailers: [retailerRow],
        price_history: [],
      },
    });
    await recordIntakePriceHistory(client, {
      productId: 'p1',
      merchantId: 'm1',
      price: 899,
      currencyCode: 'USD',
      source: 'ebay-browse-api',
      observedAt: '2026-11-13T09:00:00.000Z',
    });
    expect(client.inserts[0].row).toMatchObject({
      source: 'ebay-browse-api',
      observed_at: '2026-11-13T09:00:00.000Z',
    });
  });

  it('skips an unchanged re-approve', async () => {
    const client = fakeClient({
      tables: {
        merchants: [merchantRow],
        retailers: [retailerRow],
        price_history: [
          {
            product_id: 'p1',
            retailer_id: 'r1',
            price: 999,
            availability: 'unknown',
            recorded_at: dayAgo(1),
          },
        ],
      },
    });
    const result = await recordIntakePriceHistory(client, {
      productId: 'p1',
      merchantId: 'm1',
      price: 999,
      currencyCode: 'USD',
      source: 'manual-intake',
      observedAt: null,
    });
    expect(result.recorded).toBe(false);
    expect(result.reason).toBe('unchanged');
    expect(client.inserts).toHaveLength(0);
  });

  it('skips honestly when no retailers row matches the merchant slug', async () => {
    const client = fakeClient({
      tables: { merchants: [merchantRow], retailers: [], price_history: [] },
    });
    const result = await recordIntakePriceHistory(client, {
      productId: 'p1',
      merchantId: 'm1',
      price: 999,
      currencyCode: 'USD',
      source: 'manual-intake',
      observedAt: null,
    });
    expect(result.recorded).toBe(false);
    expect(result.reason).toBe('no-retailer-row');
  });
});

// ---------------------------------------------------------------------------
// F-P1-13 / F-P1-14 — intake evidence
// ---------------------------------------------------------------------------

describe('resolveIntakeAvailability (F-P1-13)', () => {
  it('records only what the source supplied, else unknown — never in_stock by default', () => {
    expect(resolveIntakeAvailability()).toBe('unknown');
    expect(resolveIntakeAvailability(null)).toBe('unknown');
    expect(resolveIntakeAvailability('')).toBe('unknown');
    expect(resolveIntakeAvailability('bogus')).toBe('unknown');
    expect(resolveIntakeAvailability('in_stock')).toBe('in_stock');
    expect(resolveIntakeAvailability('out_of_stock')).toBe('out_of_stock');
  });
});

describe('resolveIntakeDataFreshness (F-P1-14)', () => {
  it('manual intake never stamps a check date', () => {
    expect(resolveIntakeDataFreshness('manual-intake', '2026-11-13T00:00:00.000Z')).toBeNull();
    expect(resolveIntakeDataFreshness('manual-intake')).toBeNull();
  });

  it('eBay stamps the preview fetch time, never the approve time', () => {
    expect(resolveIntakeDataFreshness('ebay-browse-api', '2026-11-13T09:00:00.000Z')).toBe(
      '2026-11-13T09:00:00.000Z'
    );
  });

  it('eBay without a carried preview time stamps nothing', () => {
    expect(resolveIntakeDataFreshness('ebay-browse-api')).toBeNull();
    expect(resolveIntakeDataFreshness('ebay-browse-api', 'not-a-date')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F-P1-05 — product attribution
// ---------------------------------------------------------------------------

describe('getProductAttribution (F-P1-05)', () => {
  it('returns a single primary source when exactly one exists', async () => {
    const client = fakeClient({
      tables: {
        merchant_products: [
          {
            product_id: 'p1',
            merchant_id: 'm1',
            price_source: 'manual-intake',
            price_verified_at: null,
          },
        ],
        merchants: [{ id: 'm1', name: 'Amazon' }],
        product_sources: [],
        price_history: [],
        product_attributes: [],
      },
    });
    const attr = await getProductAttribution(client, 'p1');
    expect(attr.sources).toEqual(['manual-intake']);
    expect(attr.primarySource).toBe('manual-intake');
    expect(attr.hasAnyAttribution).toBe(true);
    expect(attr.merchantSources[0].merchantName).toBe('Amazon');
  });

  it('primarySource is null with several sources — never picks a favourite', async () => {
    const client = fakeClient({
      tables: {
        merchant_products: [
          {
            product_id: 'p1',
            merchant_id: 'm1',
            price_source: 'manual-intake',
            price_verified_at: null,
          },
        ],
        merchants: [{ id: 'm1', name: 'Amazon' }],
        product_sources: [
          {
            product_id: 'p1',
            provider_key: 'ebay-browse-api',
            retailer_id: 'r1',
            external_id: 'e1',
            last_fetched_at: '2026-11-13T00:00:00.000Z',
          },
        ],
        price_history: [{ product_id: 'p1', source: 'merchant-feed' }],
        product_attributes: [],
      },
    });
    const attr = await getProductAttribution(client, 'p1');
    expect(attr.sources).toEqual(['ebay-browse-api', 'manual-intake', 'merchant-feed']);
    expect(attr.primarySource).toBeNull();
    expect(attr.historySources).toEqual(['merchant-feed']);
  });

  it('fail-closed: no rows anywhere means unattributed, never guessed', async () => {
    const client = fakeClient({
      tables: {
        merchant_products: [],
        merchants: [],
        product_sources: [],
        price_history: [],
        product_attributes: [],
      },
    });
    const attr = await getProductAttribution(client, 'p1');
    expect(attr.hasAnyAttribution).toBe(false);
    expect(attr.sources).toEqual([]);
    expect(attr.primarySource).toBeNull();
  });

  it('045 unapplied: columnsMissing, listing sources unknown — not "manual-intake" by default', async () => {
    const client = fakeClient({
      tables: {
        merchant_products: [{ product_id: 'p1', merchant_id: 'm1' }],
        merchants: [{ id: 'm1', name: 'Amazon' }],
        product_sources: [],
        price_history: [],
        product_attributes: [],
      },
      failFirstSelectWith: { match: 'price_source', code: '42703' },
    });
    const attr = await getProductAttribution(client, 'p1');
    expect(attr.columnsMissing).toBe(true);
    expect(attr.merchantSources[0].priceSource).toBeNull();
    expect(attr.hasAnyAttribution).toBe(false);
  });
});

describe('recordProductAttribution (F-P1-05)', () => {
  it('upserts a product_sources row', async () => {
    const client = fakeClient({ tables: {} });
    const ok = await recordProductAttribution(client, {
      productId: 'p1',
      retailerId: 'r1',
      externalId: 'ext-1',
      providerKey: 'ebay-browse-api',
      fetchedAt: '2026-11-13T09:00:00.000Z',
    });
    expect(ok).toBe(true);
    expect(client.upserts).toHaveLength(1);
    expect(client.upserts[0].row).toMatchObject({
      product_id: 'p1',
      external_id: 'ext-1',
      provider_key: 'ebay-browse-api',
    });
  });

  it('refuses to record without an external id — never invents one', async () => {
    const client = fakeClient({ tables: {} });
    const ok = await recordProductAttribution(client, {
      productId: 'p1',
      retailerId: 'r1',
      externalId: '   ',
      providerKey: 'manual-intake',
    });
    expect(ok).toBe(false);
    expect(client.upserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F-P2-24 — retention
// ---------------------------------------------------------------------------

describe('price-history retention (F-P2-24)', () => {
  it('policy is append-only with indefinite retention', () => {
    const policy = getPriceHistoryRetentionPolicy();
    expect(policy.appendOnly).toBe(true);
    expect(policy.retention).toBe('indefinite');
    expect(policy.requiresOwnerApproval).toBe(true);
    expect(policy.requiresAuditTableBeforeAnyDeletion).toBe(true);
  });

  it('a plan lists old rows as archival candidates and deletes nothing', () => {
    const plan = planPriceHistoryArchival(
      [
        { id: 'old', productId: 'p1', recordedAt: dayAgo(6 * 365) },
        { id: 'new', productId: 'p1', recordedAt: dayAgo(10) },
      ],
      NOW
    );
    expect(plan.candidates.map((c) => c.id)).toEqual(['old']);
    expect(plan.deletes).toBe(0);
    expect(plan.requiresOwnerApproval).toBe(true);
    expect(plan.ownerActionRequired).toMatch(/070/);
  });

  it('no candidates when nothing is older than the window', () => {
    const plan = planPriceHistoryArchival(
      [{ id: 'new', productId: 'p1', recordedAt: dayAgo(10) }],
      NOW
    );
    expect(plan.candidates).toEqual([]);
    expect(plan.deletes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Quality writer still carries provenance (unchanged contract)
// ---------------------------------------------------------------------------

describe('insertPriceHistoryRow via intake path', () => {
  it('the intake insert keeps the tiered 42703 retry (legacy row only when 057 is missing)', async () => {
    // W1's tiered retry (F-P1-15/F-P1-58): tier 1 = everything,
    // tier 3 = provenance without currency_code, tier 4 = legacy
    // 002 columns only. With no verified/currencyAssumed flags
    // tier 2 is skipped, so a pre-057 table fails tiers 1 and 3
    // before the legacy tier-4 insert succeeds.
    const recorded: Array<{ table: string; row: Row }> = [];
    let calls = 0;
    const insertClient = {
      inserts: recorded,
      from(table: string) {
        return {
          insert: (row: Row) => {
            calls += 1;
            recorded.push({ table, row });
            return Promise.resolve({
              data: null,
              error:
                calls <= 2
                  ? { message: 'column does not exist', code: '42703' }
                  : null,
            });
          },
        };
      },
    } as unknown as AnySupabaseClient & {
      inserts: Array<{ table: string; row: Row }>;
    };
    const { error } = await insertPriceHistoryRow(insertClient, {
      product_id: 'p1',
      retailer_id: 'r1',
      price: 999,
      currency: 'USD',
      availability: 'unknown',
      source: 'manual-intake',
      observed_at: null,
    });
    expect(error).toBeNull();
    expect(insertClient.inserts).toHaveLength(3);
    expect(insertClient.inserts[2].row).not.toHaveProperty('source');
    expect(insertClient.inserts[2].row).toMatchObject({ price: 999, availability: 'unknown' });
  });
});
