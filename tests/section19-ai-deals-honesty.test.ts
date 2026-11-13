/**
 * Section 19, Phase 0 (§12 #24) — fixed-discount percentage honesty.
 *
 * The old formula gave every fixed-amount deal
 * `discountPercentage = (discountValue/100)*10` — a $20-off deal
 * showed a made-up "2%" whether the product cost $99 or $999,
 * and that invented number fed aiScore and the featured flag.
 *
 * The honest derivation is discountValue / current recorded price:
 * $20 off a $99 product is 20.2% off; $20 off with no recorded
 * price at all is null (no percentage), contributing 0 to the
 * score. The discriminator is deliberate: for a $20 deal the old
 * formula says 2% — so the $99-product case (real 20.2%) proves
 * the fabricated number is gone, and the no-price case proves
 * null is reported instead of an invention.
 *
 * The Supabase client is a small chainable stub (thenable builder
 * with eq / neq / in / is / gte / order / limit / maybeSingle /
 * insert). getRankedDeals (not the swrGet-cached wrapper) is
 * called directly so tests never share cache entries.
 */

import { describe, expect, it } from 'vitest';
import { getRankedDeals } from '@/services/ai-deals';
import type { AnySupabaseClient } from '@/lib/supabase/types';

type Row = Record<string, unknown>;

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

const PRODUCT_99: Row = {
  id: 'p99',
  name: 'Logitech MX Master 3S',
  slug: 'logitech-mx-master-3s',
  description: 'A mouse.',
  brand: 'Logitech',
  category: 'Accessories',
  image_url: null,
  gtin: null,
  confidence_score: 80,
  data_freshness: '2026-11-02T00:00:00.000Z',
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
  deleted_at: null,
};

const PRODUCT_NOPRICE: Row = {
  ...PRODUCT_99,
  id: 'p-noprice',
  name: 'Mystery Gadget',
  slug: 'mystery-gadget',
};

function dealRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'd1',
    product_id: 'p99',
    merchant_id: 'm-amazon',
    title: 'Save $20 on Logitech MX Master 3S',
    description: null,
    deal_type: 'general',
    discount_type: 'fixed',
    discount_value: 20,
    start_at: '2026-11-01T00:00:00.000Z',
    end_at: '2027-01-01T00:00:00.000Z',
    coupon_code: null,
    url: null,
    active: true,
    deleted_at: null,
    ...overrides,
  };
}

describe('getRankedDeals — fixed-discount percentage is derived, never invented', () => {
  it('$20 off a $99 product is 20.2% off — not the old fabricated 2%', async () => {
    const inserts: Row[] = [];
    const supabase = createStubSupabase(
      {
        deal_rankings: [],
        deals: [dealRow()],
        products: [PRODUCT_99],
        price_history: [
          { product_id: 'p99', price: 99, recorded_at: '2026-11-02T00:00:00.000Z' },
        ],
      },
      inserts
    );
    const result = await getRankedDeals(supabase, { limit: 10 });
    expect(result.deals).toHaveLength(1);
    const ranked = result.deals[0];
    // Real derivation: 20 / 99 * 100 = 20.2 (1 decimal).
    expect(ranked.discountPercentage).toBe(20.2);
    expect(ranked.discountPercentage).not.toBe(2);
    // aiScore consumes the honest percentage: 50 + 20.2*0.5 + 10
    // (Section 19, Phase 2 §12 #59 value term: current $99 is at
    // the recorded low $99) = 70.1. Section 20, §12 #67: the old
    // +10 confidence term is REMOVED — no completeness term in
    // the score.
    expect(ranked.aiScore).toBeCloseTo(70.1, 5);
    // …but the score is ABOVE the 75 featured bar and the deal is
    // still NOT featured: only 1 recorded price point, so the
    // §12 #60 evidence gate withholds the flag (validation
    // `insufficient`). Score ≠ featured.
    expect(ranked.isFeatured).toBe(false);
    expect(ranked.currentPrice).toBe(99);
    // The stored row keeps the honest percentage too.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].discount_percentage).toBe(20.2);
  });

  it('$20 off with no recorded price reports null and contributes 0 to the score', async () => {
    const inserts: Row[] = [];
    const supabase = createStubSupabase(
      {
        deal_rankings: [],
        deals: [dealRow({ product_id: 'p-noprice' })],
        products: [PRODUCT_NOPRICE],
        price_history: [],
      },
      inserts
    );
    const result = await getRankedDeals(supabase, { limit: 10 });
    expect(result.deals).toHaveLength(1);
    const ranked = result.deals[0];
    expect(ranked.discountPercentage).toBeNull();
    // aiScore: 50 + 0 (null contributes nothing) = 50. Section 20,
    // §12 #67: the old +10 confidence term is REMOVED.
    expect(ranked.aiScore).toBe(50);
    expect(ranked.isFeatured).toBe(false);
    expect(ranked.currentPrice).toBeNull();
    // The NOT NULL column stores 0 as a placeholder; the API
    // surface above is what must stay null.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].discount_percentage).toBe(0);
  });

  it('percentage deals keep their merchant-stated value unchanged', async () => {
    const inserts: Row[] = [];
    const supabase = createStubSupabase(
      {
        deal_rankings: [],
        deals: [
          dealRow({
            id: 'd-pct',
            discount_type: 'percentage',
            discount_value: 25,
            title: '25% off Logitech MX Master 3S',
          }),
        ],
        products: [PRODUCT_99],
        price_history: [
          { product_id: 'p99', price: 99, recorded_at: '2026-11-02T00:00:00.000Z' },
        ],
      },
      inserts
    );
    const result = await getRankedDeals(supabase, { limit: 10 });
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0].discountPercentage).toBe(25);
  });

  it('cached path: a legacy row carrying the fabricated 2% is recomputed to 20.2%', async () => {
    const inserts: Row[] = [];
    const supabase = createStubSupabase(
      {
        // Written by the old code: (20/100)*10 = 2, aiScore built on it.
        deal_rankings: [
          {
            id: 'r-old',
            deal_id: 'd1',
            product_id: 'p99',
            deal_type: 'general',
            ai_score: 61,
            discount_percentage: 2,
            savings_amount: 20,
            is_featured: false,
            ranked_at: '2026-11-10T00:00:00.000Z',
          },
        ],
        deals: [dealRow()],
        products: [PRODUCT_99],
        price_history: [
          { product_id: 'p99', price: 99, recorded_at: '2026-11-02T00:00:00.000Z' },
        ],
      },
      inserts
    );
    const result = await getRankedDeals(supabase, { limit: 10 });
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0].discountPercentage).toBe(20.2);
    expect(result.deals[0].discountPercentage).not.toBe(2);
    // Re-scored with the honest percentage + the §12 #59 value
    // term (current $99 at the recorded low $99): 50 + 20.2*0.5
    // + 10 (value) = 70.1. Section 20, §12 #67: the old +10
    // confidence term is REMOVED. Still not featured:
    // 1 history point → validation `insufficient` (§12 #60 gate).
    expect(result.deals[0].aiScore).toBeCloseTo(70.1, 5);
    expect(result.deals[0].isFeatured).toBe(false);
  });
});
