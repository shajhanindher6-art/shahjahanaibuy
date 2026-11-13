/**
 * Section 19, Phase 9 (§12 #82) — AI data-accuracy tests.
 *
 * With 0 reviews + 0 specs + stale prices in the fixtures, assert
 * the outputs of ai-summary, ai-deals, ai-comparison, and the
 * assistant contain:
 *   - no invented specification (only recorded attributes are named),
 *   - no invented review quote or rating,
 *   - no invented price (every dollar figure is a recorded price),
 *   - no fabricated discount percentage.
 *
 * What is NOT duplicated here (already covered elsewhere):
 *   - ai-summary honest fallbacks — tests/section19-ai-summary-honesty.test.ts
 *   - ai-summary freshness qualification — tests/section19-ai-summary-freshness.test.ts
 *   - fixed-discount % derivation — tests/section19-ai-deals-honesty.test.ts
 *   - comparison warranty/shipping/seller nulls + reliability —
 *     tests/section19-phase5-comparison.test.ts
 *   - assistant pros/cons with 0 reviews + 0 specs —
 *     tests/section19-phase5-assistant.test.ts
 *   - legacy prediction guard below 5 points —
 *     tests/section19-phase3-prediction.test.ts
 *
 * The Supabase client is a small chainable stub (thenable builder
 * with eq / neq / in / is / gt / gte / or / order / limit /
 * maybeSingle / insert). getRankedDeals (not the swrGet-cached
 * wrapper) is called directly so tests never share cache entries;
 * the summary / prediction services cache through swrGet, so
 * product ids are unique per test.
 */

import { describe, expect, it } from 'vitest';
import { getAISummary } from '@/services/ai-summary';
import { getRankedDeals } from '@/services/ai-deals';
import { compareProducts } from '@/services/ai-comparison';
import { recommendAssistant } from '@/services/personal-assistant';
import { parseSearchIntent } from '@/services/ai-search';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import type { Product } from '@/types';

type Row = Record<string, unknown>;

function createStubSupabase(tables: Record<string, Row[]>): AnySupabaseClient {
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
      gt(col: string, val: unknown) {
        rows = rows.filter((r) => String(r[col]) > String(val));
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
      or() {
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
      insert() {
        return Promise.resolve({ data: null, error: null });
      },
      then(
        onFulfilled?: (value: { data: Row[]; error: null; count: number }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(
          onFulfilled,
          onRejected
        );
      },
    };
    return builder;
  };
  return { from: (table: string) => query(table) } as unknown as AnySupabaseClient;
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p19-acc-sum',
    name: 'Test Widget',
    slug: 'test-widget',
    description: 'A test product.',
    brand: null,
    category: 'Gadgets',
    imageUrl: null,
    gtin: null,
    confidenceScore: 50,
    dataFreshness: '2026-11-02T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  } as Product;
}

function summaryStub(overrides: Record<string, Row[]> = {}): AnySupabaseClient {
  return createStubSupabase({
    ai_summaries: [],
    reviews: [],
    product_attributes: [],
    product_variants: [],
    price_history: [],
    products: [],
    ...overrides,
  });
}

/** Every dollar figure in `text` — as a number — for the recorded-price check. */
function dollarFigures(text: string): number[] {
  return [...text.matchAll(/\$(\d+(?:,\d{3})*(?:\.\d+)?)/g)].map((m) =>
    parseFloat(m[1].replace(/,/g, ''))
  );
}

describe('ai-summary — no invented spec, review, or price (#82)', () => {
  it('0 reviews + 0 specs + 0 prices → no price, no rating, no spec anywhere in the output', async () => {
    const summary = await getAISummary(summaryStub(), product({ id: 'p19-acc-sum-empty' }));
    expect(summary).not.toBeNull();
    const joined = [summary!.summary, ...summary!.pros, ...summary!.cons].join(' ');
    expect(dollarFigures(joined)).toEqual([]);
    expect(joined).not.toContain('stars');
    expect(joined).not.toContain('rating');
    for (const specWord of ['RAM', 'Storage', 'Battery', 'Camera', 'Processor', 'Display', 'Weight', 'Screen']) {
      expect(joined).not.toContain(specWord);
    }
    expect(joined).not.toContain('reputable brand');
    expect(joined).not.toContain('quality standards');
  });

  it('with one recorded spec, only that spec is named — nothing else is invented', async () => {
    const summary = await getAISummary(
      summaryStub({
        product_attributes: [
          { product_id: 'p19-acc-sum-onespec', key: 'RAM', value: '16GB' },
        ],
      }),
      product({ id: 'p19-acc-sum-onespec' })
    );
    expect(summary).not.toBeNull();
    const joined = [summary!.summary, ...summary!.pros, ...summary!.cons].join(' ');
    expect(joined).toContain('RAM: 16GB');
    for (const invented of ['Storage', 'Battery', 'Camera', 'Processor', 'Display', 'Weight', 'Screen', 'Bluetooth', 'Wi-Fi']) {
      expect(joined).not.toContain(invented);
    }
    // Exactly one "key: value" spec line — the recorded one.
    const specLines = summary!.pros.filter((p) => /^[A-Za-z][A-Za-z /]*: \S/.test(p));
    expect(specLines).toEqual(['RAM: 16GB']);
  });

  it('stale price history → the output never prints a price at all, invented or real', async () => {
    const summary = await getAISummary(
      summaryStub({
        price_history: [
          { product_id: 'p19-acc-sum-stale', price: 1099, recorded_at: '2026-10-20T00:00:00.000Z' },
          { product_id: 'p19-acc-sum-stale', price: 1049, recorded_at: '2026-10-27T00:00:00.000Z' },
          { product_id: 'p19-acc-sum-stale', price: 1029, recorded_at: '2026-10-30T00:00:00.000Z' },
          { product_id: 'p19-acc-sum-stale', price: 999, recorded_at: '2026-11-02T00:00:00.000Z' },
        ],
      }),
      product({ id: 'p19-acc-sum-stale' })
    );
    expect(summary).not.toBeNull();
    const joined = [summary!.summary, ...summary!.pros, ...summary!.cons].join(' ');
    // The service reasons about the recorded low without ever
    // printing a dollar figure — so no price can be invented.
    expect(dollarFigures(joined)).toEqual([]);
    expect(joined).not.toContain('making it a good time to buy');
  });
});

describe('ai-deals — prices and percentages come only from recorded rows (#82)', () => {
  const PRODUCT_99: Row = {
    id: 'p19-acc-99',
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

  function dealsStub(deals: Row[], products: Row[], priceHistory: Row[]): AnySupabaseClient {
    return createStubSupabase({
      deal_rankings: [],
      deals,
      products,
      price_history: priceHistory,
      ai_predictions: [],
    });
  }

  function dealRow(overrides: Partial<Row> = {}): Row {
    return {
      id: 'd-acc-1',
      product_id: 'p19-acc-99',
      merchant_id: 'm-amazon',
      title: 'Save $20 on Logitech MX Master 3S',
      description: null,
      deal_type: 'general',
      discount_type: 'fixed',
      discount_value: 20,
      start_at: '2026-11-01T00:00:00.000Z',
      end_at: '2027-06-01T00:00:00.000Z',
      coupon_code: null,
      url: 'https://example.com/deal',
      active: true,
      deleted_at: null,
      ...overrides,
    };
  }

  it('fixed $20-off deal: currentPrice is the recorded latest price, % is derived from it', async () => {
    const result = await getRankedDeals(
      dealsStub(
        [dealRow()],
        [PRODUCT_99],
        [
          { product_id: 'p19-acc-99', price: 109, recorded_at: '2026-10-20T00:00:00.000Z' },
          { product_id: 'p19-acc-99', price: 99, recorded_at: '2026-11-02T00:00:00.000Z' },
        ]
      )
    );
    expect(result.total).toBe(1);
    const row = result.deals[0];
    expect(row.currentPrice).toBe(99); // recorded latest — not 109, not a guess
    expect(row.discountPercentage).toBe(20.2); // 20 / 99, never the old fabricated 2%
    expect(row.savingsAmount).toBe(20);
  });

  it('percentage deal: % is the merchant-stated value, price is the recorded latest', async () => {
    const result = await getRankedDeals(
      dealsStub(
        [dealRow({ id: 'd-acc-2', product_id: 'p19-acc-999', discount_type: 'percentage', discount_value: 25, title: '25% off' })],
        [{ ...PRODUCT_99, id: 'p19-acc-999', name: 'Priced Gadget', slug: 'priced-gadget' }],
        [
          { product_id: 'p19-acc-999', price: 1099, recorded_at: '2026-10-20T00:00:00.000Z' },
          { product_id: 'p19-acc-999', price: 999, recorded_at: '2026-11-02T00:00:00.000Z' },
        ]
      )
    );
    expect(result.total).toBe(1);
    expect(result.deals[0].discountPercentage).toBe(25);
    expect(result.deals[0].currentPrice).toBe(999); // recorded latest, not 1099
    expect(result.deals[0].savingsAmount).toBe(0);
  });

  it('fixed deal with no recorded price: null % and a score with no invented % term', async () => {
    const result = await getRankedDeals(
      dealsStub([dealRow()], [PRODUCT_99], [])
    );
    expect(result.total).toBe(1);
    const row = result.deals[0];
    expect(row.currentPrice).toBeNull();
    expect(row.discountPercentage).toBeNull();
    // 50 base + 0 (null % contributes nothing) + 0 flash + 0
    // (value < $30) + 10 (confidence 80) + 0 (no history) = 60.
    expect(row.aiScore).toBe(60);
    expect(row.isFeatured).toBe(false);
  });
});

describe('ai-comparison — no invented rating, price, or spec (#82)', () => {
  function comparisonStub(): AnySupabaseClient {
    const products: Row[] = [
      {
        id: 'p19-acc-cmp-a',
        name: 'MacBook Air 13',
        slug: 'macbook-air-13',
        description: 'A laptop.',
        brand: 'Apple',
        category: 'Laptops',
        image_url: null,
        gtin: null,
        confidence_score: 90,
        data_freshness: '2026-11-02T00:00:00.000Z',
        created_at: '2026-11-01T00:00:00.000Z',
        updated_at: '2026-11-01T00:00:00.000Z',
        deleted_at: null,
      },
      {
        id: 'p19-acc-cmp-b',
        name: 'Dell XPS 13',
        slug: 'dell-xps-13',
        description: 'A laptop.',
        brand: 'Dell',
        category: 'Laptops',
        image_url: null,
        gtin: null,
        confidence_score: 85,
        data_freshness: '2026-11-02T00:00:00.000Z',
        created_at: '2026-11-01T00:00:00.000Z',
        updated_at: '2026-11-01T00:00:00.000Z',
        deleted_at: null,
      },
    ];
    const priceHistory: Row[] = [];
    for (const pid of ['p19-acc-cmp-a', 'p19-acc-cmp-b']) {
      // 4 recorded points each (stale) — below the 5-point Deal
      // Score threshold, so no score may be shown.
      for (const [price, day] of [
        [1099, '2026-10-20'],
        [1049, '2026-10-27'],
        [1029, '2026-10-30'],
        [999, '2026-11-02'],
      ] as const) {
        priceHistory.push({ product_id: pid, price, recorded_at: `${day}T00:00:00.000Z` });
      }
    }
    return createStubSupabase({
      products,
      merchants: [
        { id: 'm-amazon', name: 'Amazon', website_url: 'https://amazon.com', active: true, deleted_at: null },
      ],
      reviews: [],
      merchant_products: [
        {
          product_id: 'p19-acc-cmp-a',
          merchant_id: 'm-amazon',
          price: 999,
          compare_at_price: 1299,
          availability: 'in_stock',
          url: 'https://amazon.com/macbook',
          in_stock: true,
          shipping_cost: 0,
          shipping_days: 3,
          deleted_at: null,
        },
        {
          product_id: 'p19-acc-cmp-b',
          merchant_id: 'm-amazon',
          price: 1099,
          compare_at_price: null,
          availability: 'in_stock',
          url: 'https://amazon.com/dell',
          in_stock: true,
          shipping_cost: null,
          shipping_days: null,
          deleted_at: null,
        },
      ],
      price_history: priceHistory,
      ai_predictions: [],
    });
  }

  it('retailer prices equal the recorded merchant prices; discount only from a recorded compare-at', async () => {
    const result = await compareProducts(comparisonStub(), ['p19-acc-cmp-a', 'p19-acc-cmp-b']);
    expect(result).not.toBeNull();
    const [a, b] = result!.products;
    expect(a.retailers).toHaveLength(1);
    expect(a.retailers[0].price).toBe(999);
    expect(a.retailers[0].originalPrice).toBe(1299);
    expect(a.retailers[0].discount).toBe(23); // (1 - 999/1299) — recorded only
    expect(b.retailers).toHaveLength(1);
    expect(b.retailers[0].price).toBe(1099);
    expect(b.retailers[0].originalPrice).toBeNull();
    expect(b.retailers[0].discount).toBeNull(); // no recorded compare-at → no invented %
  });

  it('0 reviews → no invented rating anywhere, and no Deal Score on 4 points', async () => {
    const result = await compareProducts(comparisonStub(), ['p19-acc-cmp-a', 'p19-acc-cmp-b']);
    expect(result).not.toBeNull();
    for (const p of result!.products) {
      for (const r of p.retailers) {
        expect(r.rating).toBeNull();
        expect(r.reviewCount).toBe(0);
      }
      expect(p.dealScore).toBeNull();
      expect(p.dealScoreDataPoints).toBe(4);
    }
    expect(result!.aiSummary).not.toContain('stars');
  });

  it('the comparison summary prints only recorded prices — no invented figure', async () => {
    const result = await compareProducts(comparisonStub(), ['p19-acc-cmp-a', 'p19-acc-cmp-b']);
    expect(result).not.toBeNull();
    const figures = dollarFigures(result!.aiSummary);
    expect(figures.length).toBeGreaterThan(0);
    for (const figure of figures) {
      expect([999, 1099, 1299]).toContain(figure);
    }
    for (const invented of ['RAM', 'Storage', 'Battery', 'Camera', 'Processor']) {
      expect(result!.aiSummary).not.toContain(invented);
    }
  });
});

describe('assistant — empty catalog means an honest no-match, never an invented pick (#82)', () => {
  it('recommendAssistant with no products names no product and picks nothing', async () => {
    const stub = createStubSupabase({ products: [] });
    const intent = parseSearchIntent('best laptop under $1200');
    const answer = await recommendAssistant(stub, intent, 'laptop');
    expect(answer.content).toContain("couldn't find");
    expect(answer.content).not.toContain('🏆 Best pick');
    expect(answer.content).not.toContain('MacBook');
    expect(answer.content).not.toContain('Dell');
    expect(answer.content).toContain('verified price');
    expect(answer.metadata).toBeNull();
  });
});
