/**
 * Section 19, Phase 2 — deal ranking history validation,
 * featured evidence gate, value ranking, duplicate-deal
 * detection + dedupe, coupon history cross-check
 * (§12 #23, #58, #59, #60, #66; task items 6, 7, 8, 10).
 *
 * Pure-function tests use hand-built histories; the
 * getRankedDeals tests reuse the chainable Supabase stub from
 * tests/section19-ai-deals-honesty.test.ts (getRankedDeals, not
 * the swrGet-cached wrapper, so tests never share cache entries).
 */

import { describe, expect, it } from 'vitest';
import {
  validateDealDiscount,
  checkCouponDiscountAgainstHistory,
  dedupeByKey,
  dealIdentityKey,
} from '@/services/deal-validation';
import { getRankedDeals } from '@/services/ai-deals';
import type { AnySupabaseClient } from '@/lib/supabase/types';

type Row = Record<string, unknown>;

const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-12T12:00:00.000Z');

function at(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString();
}

// Clean history: gentle drop, no pattern. 4 points over 20 days.
function cleanHistory(): Array<{ price: number; recordedAt: string }> {
  return [
    { price: 1099, recordedAt: at(20) },
    { price: 1049, recordedAt: at(14) },
    { price: 999, recordedAt: at(7) },
    { price: 999, recordedAt: at(2) },
  ];
}

// Fake-discount pattern: rise ≥10% then drop, latest NOT below the pre-rise price.
function fakeSaleHistory(): Array<{ price: number; recordedAt: string }> {
  return [
    { price: 900, recordedAt: at(20) },
    { price: 1100, recordedAt: at(10) },
    { price: 999, recordedAt: at(2) },
  ];
}

describe('validateDealDiscount — history validation (§12 #23)', () => {
  it('validates a clean history with a real drop', () => {
    const v = validateDealDiscount({
      history: cleanHistory(),
      currentPrice: 999,
      discountType: 'percentage',
      discountValue: 10,
    });
    expect(v.status).toBe('validated');
    expect(v.historyPoints).toBe(4);
    expect(v.inflationVerdict).toBe('no_pattern');
    expect(v.effectivePrice).toBeCloseTo(899.1, 1);
    expect(v.reason).toContain('No fake-discount or inflation pattern');
  });

  it('flags a fake-discount pattern — the claimed discount is measured against a raised price', () => {
    const v = validateDealDiscount({
      history: fakeSaleHistory(),
      currentPrice: 999,
      discountType: 'percentage',
      discountValue: 10,
    });
    expect(v.status).toBe('flagged');
    expect(v.inflationVerdict).toBe('fake_discount_pattern');
    expect(v.reason).toContain('raised');
  });

  it('is insufficient with fewer than 2 points — absence of evidence is not a pass', () => {
    const v = validateDealDiscount({
      history: [{ price: 999, recordedAt: at(2) }],
      currentPrice: 999,
      discountType: 'percentage',
      discountValue: 10,
    });
    expect(v.status).toBe('insufficient');
    expect(v.inflationVerdict).toBeNull();
    expect(v.reason).toContain('not enough history');
  });

  it('reports the 90-day lowest as evidence without gating on it', () => {
    // Span ≥90 days (1200 @ 100 days ago anchors it) with a $950
    // point inside the 90-day window, plus a clean recent series
    // so the 30-day pattern check can actually run.
    const history = [
      { price: 1200, recordedAt: at(100) },
      { price: 950, recordedAt: at(80) },
      { price: 1099, recordedAt: at(20) },
      { price: 1049, recordedAt: at(14) },
      { price: 999, recordedAt: at(7) },
      { price: 999, recordedAt: at(2) },
    ];
    const v = validateDealDiscount({
      history,
      currentPrice: 999,
      discountType: 'fixed',
      discountValue: 20,
    });
    expect(v.status).toBe('validated');
    expect(v.lowest90dReady).toBe(true);
    expect(v.lowest90d).toBe(950);
    expect(v.effectivePrice).toBe(979);
    // Effective $979 is still above the 90-day low $950 — stated,
    // but the discount is still validated (pattern-free).
    expect(v.reason).toContain('still above the lowest recorded in the last 90 days');
  });

  it('is insufficient when too few points fall inside the 30-day window, even with older history', () => {
    const v = validateDealDiscount({
      history: [
        { price: 1200, recordedAt: at(100) },
        { price: 950, recordedAt: at(80) },
        { price: 999, recordedAt: at(2) },
      ],
      currentPrice: 999,
      discountType: 'percentage',
      discountValue: 10,
    });
    // 3 points overall, but only 1 inside the last 30 days — the
    // pattern check never ran, so "no pattern" must not be claimed.
    expect(v.status).toBe('insufficient');
    expect(v.inflationVerdict).toBe('insufficient');
  });
});

describe('checkCouponDiscountAgainstHistory — coupon cross-check (§12 #22)', () => {
  it('supports a code that gets the price below the lowest recorded price', () => {
    const r = checkCouponDiscountAgainstHistory(
      { discountType: 'percentage', discountValue: 10 },
      cleanHistory(),
      999
    );
    expect(r.status).toBe('supported');
    expect(r.effectivePrice).toBeCloseTo(899.1, 1);
    expect(r.reason).toContain('at or below');
  });

  it('does not support a code whose effective price stays above the lowest recorded price', () => {
    // Current $999, recorded low $899 (an earlier dip), fixed $5
    // off → $994, still above the $899 low. Recent series is
    // pattern-free (a drop from $1099, not a rise), so the
    // verdict comes from the price comparison, not a pattern.
    const history = [
      { price: 1099, recordedAt: at(20) },
      { price: 899, recordedAt: at(14) },
      { price: 999, recordedAt: at(7) },
      { price: 999, recordedAt: at(2) },
    ];
    const r = checkCouponDiscountAgainstHistory(
      { discountType: 'fixed', discountValue: 5 },
      history,
      999
    );
    expect(r.status).toBe('unsupported');
    expect(r.effectivePrice).toBe(994);
    expect(r.reason).toContain('still above');
    expect(r.reason).toContain('no supporting history');
  });

  it('does not support a code on a fake-discount history', () => {
    const r = checkCouponDiscountAgainstHistory(
      { discountType: 'percentage', discountValue: 10 },
      fakeSaleHistory(),
      999
    );
    expect(r.status).toBe('unsupported');
  });

  it('is insufficient with too little history or no current price', () => {
    expect(
      checkCouponDiscountAgainstHistory(
        { discountType: 'percentage', discountValue: 10 },
        [{ price: 999, recordedAt: at(2) }],
        999
      ).status
    ).toBe('insufficient');
    expect(
      checkCouponDiscountAgainstHistory(
        { discountType: 'percentage', discountValue: 10 },
        cleanHistory(),
        null
      ).status
    ).toBe('insufficient');
  });
});

describe('dedupeByKey / dealIdentityKey — deal identity (§12 #66)', () => {
  it('collapses identical deals and keeps distinct ones', () => {
    const key = (d: Row) =>
      dealIdentityKey({
        productId: d.product_id as string,
        merchantId: d.merchant_id as string | null,
        discountType: d.discount_type as string,
        discountValue: d.discount_value as number,
        startAt: d.start_at as string,
        endAt: d.end_at as string,
      });
    const rows = [
      { id: 'd1', product_id: 'p1', merchant_id: 'm1', discount_type: 'percentage', discount_value: 20, start_at: '2026-11-01T00:00:00.000Z', end_at: '2027-01-01T00:00:00.000Z' },
      { id: 'd2', product_id: 'p1', merchant_id: 'm1', discount_type: 'percentage', discount_value: 20, start_at: '2026-11-01T00:00:00.000Z', end_at: '2027-01-01T00:00:00.000Z' },
      { id: 'd3', product_id: 'p1', merchant_id: 'm1', discount_type: 'percentage', discount_value: 25, start_at: '2026-11-01T00:00:00.000Z', end_at: '2027-01-01T00:00:00.000Z' },
    ];
    const out = dedupeByKey(rows, key);
    expect(out.map((r) => r.id)).toEqual(['d1', 'd3']);
  });
});

// ---------------------------------------------------------------------------
// getRankedDeals integration: featured gate + dedupe + value term.
// ---------------------------------------------------------------------------

function createStubSupabase(
  tables: Record<string, Row[]>,
  inserts: Row[]
): AnySupabaseClient {
  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
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
        inserts.push({ table, ...row });
        return Promise.resolve({ data: null, error: null });
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
  return { from: (table: string) => query(table) } as unknown as AnySupabaseClient;
}

const PRODUCT: Row = {
  id: 'p-val',
  name: 'Test Widget',
  slug: 'test-widget',
  description: 'A test product.',
  brand: 'Acme',
  category: 'Gadgets',
  image_url: null,
  gtin: null,
  confidence_score: 80,
  data_freshness: '2026-11-02T00:00:00.000Z',
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
  deleted_at: null,
};

function dealRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'd-val',
    product_id: 'p-val',
    merchant_id: 'm-amazon',
    title: '25% off Test Widget',
    description: null,
    deal_type: 'general',
    discount_type: 'percentage',
    discount_value: 25,
    start_at: '2026-11-01T00:00:00.000Z',
    end_at: '2027-06-01T00:00:00.000Z',
    coupon_code: null,
    url: null,
    active: true,
    deleted_at: null,
    ...overrides,
  };
}

// Clean 4-point history for p-val (same shape as cleanHistory, but
// recorded_at values the stub can order; current $999 = recorded low).
function historyRows(): Row[] {
  return [
    { product_id: 'p-val', price: 1099, recorded_at: '2026-10-23T00:00:00.000Z' },
    { product_id: 'p-val', price: 1049, recorded_at: '2026-10-29T00:00:00.000Z' },
    { product_id: 'p-val', price: 999, recorded_at: '2026-11-05T00:00:00.000Z' },
    { product_id: 'p-val', price: 999, recorded_at: '2026-11-02T00:00:00.000Z' },
  ];
}

describe('getRankedDeals — featured evidence gate + value term (§12 #59/#60)', () => {
  it('features a high-scoring deal ONLY when the discount validates against history', async () => {
    const inserts: Row[] = [];
    const supabase = createStubSupabase(
      {
        deal_rankings: [],
        deals: [dealRow()],
        products: [PRODUCT],
        price_history: historyRows(),
      },
      inserts
    );
    const result = await getRankedDeals(supabase, { limit: 10 });
    expect(result.deals).toHaveLength(1);
    const ranked = result.deals[0];
    // 50 + 25*0.5 + 10 (confidence) + 10 (value: $999 at recorded
    // low $999) = 82.5 — above the 75 bar — and the history is
    // clean, so the deal IS featured.
    expect(ranked.aiScore).toBeCloseTo(82.5, 5);
    expect(ranked.discountValidation?.status).toBe('validated');
    expect(ranked.isFeatured).toBe(true);
  });

  it('withholds featured when the history carries a fake-discount pattern, even at a high score', async () => {
    const inserts: Row[] = [];
    const supabase = createStubSupabase(
      {
        deal_rankings: [],
        deals: [dealRow()],
        products: [PRODUCT],
        price_history: [
          { product_id: 'p-val', price: 900, recorded_at: '2026-10-23T00:00:00.000Z' },
          { product_id: 'p-val', price: 1100, recorded_at: '2026-11-02T00:00:00.000Z' },
          { product_id: 'p-val', price: 999, recorded_at: '2026-11-10T00:00:00.000Z' },
        ],
      },
      inserts
    );
    const result = await getRankedDeals(supabase, { limit: 10 });
    expect(result.deals).toHaveLength(1);
    const ranked = result.deals[0];
    expect(ranked.aiScore).toBeGreaterThanOrEqual(75);
    expect(ranked.discountValidation?.status).toBe('flagged');
    expect(ranked.isFeatured).toBe(false);
  });
});

describe('getRankedDeals — duplicate-deal dedupe (§12 #66)', () => {
  it('two identical active deals rank as one row', async () => {
    const inserts: Row[] = [];
    const supabase = createStubSupabase(
      {
        deal_rankings: [],
        deals: [dealRow({ id: 'd-dup-1' }), dealRow({ id: 'd-dup-2' })],
        products: [PRODUCT],
        price_history: historyRows(),
      },
      inserts
    );
    const result = await getRankedDeals(supabase, { limit: 10 });
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0].dealId).toBe('d-dup-1');
    // One deal_rankings insert, not two.
    expect(inserts).toHaveLength(1);
  });

  it('deals that differ in discount value are NOT collapsed', async () => {
    const inserts: Row[] = [];
    const supabase = createStubSupabase(
      {
        deal_rankings: [],
        deals: [dealRow({ id: 'd-a' }), dealRow({ id: 'd-b', discount_value: 30 })],
        products: [PRODUCT],
        price_history: historyRows(),
      },
      inserts
    );
    const result = await getRankedDeals(supabase, { limit: 10 });
    expect(result.deals).toHaveLength(2);
  });
});
