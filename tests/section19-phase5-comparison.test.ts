/**
 * Section 19, Phase 5 (§12 #49/#50/#51/#55/#57) — comparison:
 * warranty, merchant reliability, suitability prose, source labelling,
 * shipping/seller.
 *
 * Warranty/shipping/seller/reliability come from recorded rows only
 * (merchant policy 028 columns, merchant_products shipping columns,
 * merchants directory rows). With no warranty data live, the service
 * returns null and the UI renders the honest empty state — never a
 * fabricated term. The stub is the same chainable-builder pattern as
 * tests/section19-chat-buy-wait.test.ts, extended with gt/insert/
 * delete/single for the services compareProducts calls.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareProducts, formatShipping } from '@/services/ai-comparison';
import { scoreMerchantReliability } from '@/services/merchant-reliability';
import { buildSuitabilityExplanations } from '@/services/comparison-suitability';
import type { ComparisonProduct } from '@/types/ai';
import type { AnySupabaseClient } from '@/lib/supabase/types';

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
        rows = rows.filter((r) => {
          const v = r[col];
          if (v === null || v === undefined || val === null || val === undefined) return false;
          return String(v) > String(val);
        });
        return builder;
      },
      or(condition: string) {
        const clauses = condition.split(',').map((c) => c.trim());
        rows = rows.filter((r) =>
          clauses.some((clause) => {
            const match = /^([a-z_]+)\.ilike\.%(.+)%$/.exec(clause);
            if (!match) return false;
            const value = r[match[1]];
            return (
              typeof value === 'string' &&
              value.toLowerCase().includes(match[2].toLowerCase())
            );
          })
        );
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
      insert() {
        return Promise.resolve({ data: null, error: null });
      },
      delete() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      single() {
        return Promise.resolve({ data: rows[0] ?? null, error: null });
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

const PRODUCTS: Row[] = [
  {
    id: 'p1', name: 'MacBook Air 13', slug: 'macbook-air-13', description: null,
    brand: 'Apple', category: 'Laptops', image_url: null, gtin: null,
    confidence_score: 80, data_freshness: '2026-11-12T00:00:00.000Z',
    created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z',
    deleted_at: null,
  },
  {
    id: 'p2', name: 'Dell XPS 13', slug: 'dell-xps-13', description: 'Dell laptop',
    brand: 'Dell', category: 'Laptops', image_url: null, gtin: null,
    confidence_score: 75, data_freshness: '2026-11-02T00:00:00.000Z',
    created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z',
    deleted_at: null,
  },
];

// Amazon has a recorded 24-month warranty + website; Best Buy has
// neither (the 0-warranty-rows-live case).
const MERCHANTS: Row[] = [
  {
    id: 'm-amazon', name: 'Amazon', slug: 'amazon', website_url: 'https://www.amazon.com',
    active: true, is_verified_merchant: false, return_window_days: null,
    warranty_months: 24, reputation_score: null, return_policy_url: null,
    warranty_policy_url: null, policy_verified_at: null, deleted_at: null,
  },
  {
    id: 'm-bb', name: 'Best Buy', slug: 'best-buy', website_url: null,
    active: true, is_verified_merchant: false, return_window_days: null,
    warranty_months: null, reputation_score: null, return_policy_url: null,
    warranty_policy_url: null, policy_verified_at: null, deleted_at: null,
  },
];

const MERCHANT_PRODUCTS: Row[] = [
  { product_id: 'p1', merchant_id: 'm-amazon', price: 999, compare_at_price: 1099, url: null, in_stock: true, shipping_cost: 0, shipping_days: 3, deleted_at: null },
  { product_id: 'p1', merchant_id: 'm-bb', price: 1018.98, compare_at_price: 1099, url: null, in_stock: true, shipping_cost: 12.5, shipping_days: null, deleted_at: null },
  { product_id: 'p2', merchant_id: 'm-amazon', price: 1099, compare_at_price: 1199, url: null, in_stock: true, shipping_cost: null, shipping_days: null, deleted_at: null },
];

const PRICE_HISTORY: Row[] = [
  { product_id: 'p1', price: 1099, recorded_at: '2026-10-01T00:00:00.000Z' },
  { product_id: 'p1', price: 1049, recorded_at: '2026-10-15T00:00:00.000Z' },
  { product_id: 'p1', price: 999, recorded_at: '2026-11-02T00:00:00.000Z' },
  { product_id: 'p1', price: 999, recorded_at: '2026-11-10T00:00:00.000Z' },
  { product_id: 'p2', price: 999, recorded_at: '2026-10-01T00:00:00.000Z' },
  { product_id: 'p2', price: 1049, recorded_at: '2026-10-15T00:00:00.000Z' },
  { product_id: 'p2', price: 1099, recorded_at: '2026-11-02T00:00:00.000Z' },
  { product_id: 'p2', price: 1099, recorded_at: '2026-11-10T00:00:00.000Z' },
];

const REVIEWS: Row[] = [
  { product_id: 'p1', rating: 5 },
  { product_id: 'p1', rating: 4 },
  { product_id: 'p2', rating: 3 },
];

function stub(): AnySupabaseClient {
  return createStubSupabase({
    products: PRODUCTS,
    merchants: MERCHANTS,
    merchant_products: MERCHANT_PRODUCTS,
    price_history: PRICE_HISTORY,
    reviews: REVIEWS,
    retailers: [],
  });
}

describe('formatShipping — recorded shipping only, never guessed', () => {
  it('free shipping + days from recorded $0 cost', () => {
    expect(formatShipping(0, 3)).toBe('Free shipping · 3 days');
  });

  it('recorded cost without days', () => {
    expect(formatShipping(12.5, null)).toBe('$12.50 shipping');
  });

  it('days without a recorded cost says the cost is not recorded', () => {
    expect(formatShipping(null, 5)).toBe('5 days delivery (shipping cost not recorded)');
  });

  it('nothing recorded → null (the UI renders the honest empty state)', () => {
    expect(formatShipping(null, null)).toBeNull();
    expect(formatShipping(undefined, undefined)).toBeNull();
  });
});

describe('scoreMerchantReliability — recorded signals only', () => {
  it('bare directory listing → no score, not-enough-data, and the explanation names the gap', () => {
    const result = scoreMerchantReliability({
      merchantId: 'm-x',
      merchantName: 'No Name Store',
      inDirectory: true,
      hasWebsite: false,
      verified: null,
      trustGrade: null,
      trustScore: null,
      listingCount: 1,
      hasPolicyRecord: false,
    });
    expect(result.score).toBeNull();
    expect(result.level).toBe('unknown');
    expect(result.notEnoughData).toBe(true);
    expect(result.explanation).toContain('Not enough data to score No Name Store');
    expect(result.explanation).toContain('no website');
  });

  it('full signals → a score with the signals that fed it named', () => {
    const result = scoreMerchantReliability({
      merchantId: 'm-y',
      merchantName: 'Full Signals Store',
      inDirectory: true,
      hasWebsite: true,
      verified: true,
      trustGrade: 'B',
      trustScore: 82,
      listingCount: 12,
      hasPolicyRecord: true,
    });
    // 10 directory + 10 website + 30 verified + 20 grade B + 15 coverage + 10 policy.
    expect(result.score).toBe(95);
    expect(result.level).toBe('high');
    expect(result.notEnoughData).toBe(false);
    expect(result.explanation).toContain('Reliability 95/100 (high)');
    expect(result.explanation).toContain('Verified Merchant badge');
  });

  it('a merchant with only a website and listings scores low — never inflated', () => {
    const result = scoreMerchantReliability({
      merchantId: 'm-z',
      merchantName: 'Thin Store',
      inDirectory: true,
      hasWebsite: true,
      verified: false,
      trustGrade: null,
      trustScore: null,
      listingCount: 2,
      hasPolicyRecord: false,
    });
    expect(result.score).toBe(30);
    expect(result.level).toBe('low');
  });
});

describe('compareProducts — warranty / shipping / seller / reliability rows', () => {
  it('renders recorded warranty + shipping + seller, and nulls where nothing is recorded', async () => {
    const comparison = await compareProducts(stub(), ['p1', 'p2']);
    expect(comparison).not.toBeNull();
    const macbook = comparison!.products.find((p) => p.productId === 'p1')!;
    const amazon = macbook.retailers.find((r) => r.retailerName === 'Amazon')!;
    const bestBuy = macbook.retailers.find((r) => r.retailerName === 'Best Buy')!;
    const dell = comparison!.products.find((p) => p.productId === 'p2')!;

    // #49 warranty: recorded 24 months for Amazon, nothing for Best Buy.
    expect(amazon.warranty).toBe('24-month warranty (recorded merchant policy)');
    expect(bestBuy.warranty).toBeNull();
    // #57 shipping: recorded $0/3 days for Amazon, $12.50 for Best
    // Buy, nothing for Dell's listing.
    expect(amazon.shipping).toBe('Free shipping · 3 days');
    expect(bestBuy.shipping).toBe('$12.50 shipping');
    expect(dell.retailers[0].shipping).toBeNull();
    // #57 seller: the merchant of record, never an invented name.
    expect(amazon.seller).toBe('Amazon');
    expect(bestBuy.seller).toBe('Best Buy');
    expect(dell.retailers[0].seller).toBe('Amazon');
  });

  it('reliability: Amazon scores from real signals, Best Buy gets not-enough-data', async () => {
    const comparison = await compareProducts(stub(), ['p1', 'p2']);
    expect(comparison).not.toBeNull();
    const macbook = comparison!.products.find((p) => p.productId === 'p1')!;
    const amazon = macbook.retailers.find((r) => r.retailerName === 'Amazon')!;
    const bestBuy = macbook.retailers.find((r) => r.retailerName === 'Best Buy')!;

    // Amazon: directory 10 + website 10 + 2 listings 10 + policy (warranty) 10 = 40.
    expect(amazon.reliability?.score).toBe(40);
    expect(amazon.reliability?.level).toBe('medium');
    expect(amazon.reliability?.notEnoughData).toBe(false);
    expect(amazon.reliability?.explanation).toContain('Reliability 40/100 (medium)');
    // Best Buy: bare listing only → no score at all.
    expect(bestBuy.reliability?.score).toBeNull();
    expect(bestBuy.reliability?.notEnoughData).toBe(true);
    expect(bestBuy.reliability?.explanation).toContain('Not enough data to score Best Buy');
  });

  it('source label (#55): the verdict carries the verified-data label with the freshness range', async () => {
    const comparison = await compareProducts(stub(), ['p1', 'p2']);
    expect(comparison).not.toBeNull();
    expect(comparison!.sourceLabel).toContain('based on verified recorded data');
    expect(comparison!.sourceLabel).toContain('Nov 2, 2026');
    expect(comparison!.sourceLabel).toContain('Nov 12, 2026');
    expect(comparison!.sourceLabel).toContain('general guidance');
    expect(comparison!.aiSummary).toContain('Source: based on verified recorded data');
  });

  it('suitability (#51): each requirement names the winning product + the real reason', async () => {
    const comparison = await compareProducts(stub(), ['p1', 'p2']);
    expect(comparison).not.toBeNull();
    const byRequirement = new Map(
      comparison!.suitability.map((s) => [s.requirement, s])
    );
    expect(byRequirement.size).toBe(4);

    const price = byRequirement.get('Lowest price')!;
    expect(price.bestProductName).toBe('MacBook Air 13');
    expect(price.explanation).toContain('MacBook Air 13 suits a tight budget best');
    expect(price.explanation).toContain('$999.00');
    expect(price.explanation).toContain('$100.00 less than Dell XPS 13');

    const rated = byRequirement.get('Highest rated')!;
    expect(rated.bestProductName).toBe('MacBook Air 13');
    expect(rated.explanation).toContain('4.5 stars');

    const availability = byRequirement.get('Widest availability')!;
    expect(availability.bestProductName).toBe('MacBook Air 13');
    expect(availability.explanation).toContain('2 retailers');

    const discount = byRequirement.get('Best discount')!;
    expect(discount.bestProductName).toBe('MacBook Air 13');
    expect(discount.explanation).toContain('9%');
  });
});

describe('buildSuitabilityExplanations — missing data says so', () => {
  function product(
    id: string,
    name: string,
    retailers: ComparisonProduct['retailers']
  ): ComparisonProduct {
    return {
      productId: id,
      slug: id,
      name,
      brand: null,
      image: null,
      category: null,
      retailers,
    };
  }

  function retailer(price: number, rating: number | null): ComparisonProduct['retailers'][number] {
    return {
      retailerName: 'Amazon',
      price,
      originalPrice: null,
      discount: null,
      rating,
      reviewCount: rating === null ? 0 : 1,
      shipping: null,
      availability: 'in_stock',
      seller: 'Amazon',
      warranty: null,
      url: null,
    };
  }

  it('no ratings anywhere → the rating requirement says so instead of inventing a winner', () => {
    const explanations = buildSuitabilityExplanations([
      product('p1', 'Alpha', [retailer(100, null)]),
      product('p2', 'Beta', [retailer(120, null)]),
    ]);
    const rated = explanations.find((e) => e.requirement === 'Highest rated')!;
    expect(rated.bestProductId).toBeNull();
    expect(rated.dataMissing).toContain('No ratings recorded');
    expect(rated.explanation).toContain('No ratings are recorded');
  });

  it('a price tie names every tied product, never a false single winner', () => {
    const explanations = buildSuitabilityExplanations([
      product('p1', 'Alpha', [retailer(100, 4)]),
      product('p2', 'Beta', [retailer(100, 5)]),
    ]);
    const price = explanations.find((e) => e.requirement === 'Lowest price')!;
    expect(price.bestProductId).toBeNull();
    expect(price.explanation).toContain('Alpha and Beta are tied');
    expect(price.explanation).toContain('$100.00');
  });

  it('no discounts anywhere → the discount requirement says so', () => {
    const explanations = buildSuitabilityExplanations([
      product('p1', 'Alpha', [retailer(100, 4)]),
      product('p2', 'Beta', [retailer(120, 3)]),
    ]);
    const discount = explanations.find((e) => e.requirement === 'Best discount')!;
    expect(discount.bestProductId).toBeNull();
    expect(discount.dataMissing).toContain('No discount listed');
  });
});

describe('compare page — honest empty states for warranty / shipping / seller / reliability', () => {
  it('renders the empty-state copy for all three rows plus the reliability note', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'compare', 'page.tsx'), 'utf8');
    expect(source).toContain('No warranty information recorded');
    expect(source).toContain('No shipping information recorded');
    expect(source).toContain('No seller information recorded');
    expect(source).toContain('not enough data to score this merchant');
    expect(source).toContain('Which suits what');
  });
});
