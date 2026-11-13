/**
 * Unit tests for the chat coupon / cashback intent (Section 14,
 * Chunk 2, B5): couponsAssistant answers from the coupons +
 * cashback_offers tables, labelled with validity, never inventing
 * a code — and generateChatResponse routes coupon questions to it.
 *
 * The Supabase client is a small chainable stub (thenable builder
 * with eq / neq / in / is / order / limit / maybeSingle), seeded
 * with the same rows the demo seed writes: SAVE10 (Amazon 10%),
 * BESTBUY15 (Best Buy $15), 5% Amazon cashback, plus one expired
 * coupon that must never be listed.
 */

import { describe, expect, it } from 'vitest';
import { couponsAssistant } from '@/services/personal-assistant';
import { generateChatResponse } from '@/services/chat';
import { parseSearchIntent } from '@/services/ai-search';
import { FALLBACK_REGION } from '@/lib/region';
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
      // PostgREST OR: comma-separated `field.ilike.%term%`
      // conditions (commas are OR, not AND). Only the ilike form
      // the assistant's queries use is supported.
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
      maybeSingle() {
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
    id: 'p1',
    name: 'MacBook Air 13',
    slug: 'macbook-air-13',
    brand: 'Apple',
    category: 'Laptops',
    image_url: null,
    confidence_score: 80,
    deleted_at: null,
  },
  {
    id: 'p2',
    name: 'Dell XPS 13',
    slug: 'dell-xps-13',
    brand: 'Dell',
    category: 'Laptops',
    image_url: null,
    confidence_score: 75,
    deleted_at: null,
  },
];

const MERCHANTS: Row[] = [
  { id: 'm-amazon', name: 'Amazon', slug: 'amazon' },
  { id: 'm-bb', name: 'Best Buy', slug: 'best-buy' },
];

const MERCHANT_PRODUCTS: Row[] = [
  { product_id: 'p1', merchant_id: 'm-amazon', price: 999, compare_at_price: 1099, url: null, in_stock: true, deleted_at: null },
  { product_id: 'p1', merchant_id: 'm-bb', price: 1018.98, compare_at_price: 1099, url: null, in_stock: true, deleted_at: null },
  { product_id: 'p2', merchant_id: 'm-amazon', price: 1099, compare_at_price: 1199, url: null, in_stock: true, deleted_at: null },
];

const PRICE_HISTORY: Row[] = [
  { product_id: 'p1', price: 999, recorded_at: '2026-11-10T00:00:00.000Z' },
  { product_id: 'p2', price: 1099, recorded_at: '2026-11-10T00:00:00.000Z' },
];

const COUPONS: Row[] = [
  { code: 'SAVE10', merchant_id: 'm-amazon', discount_type: 'percentage', discount_value: 10, valid_until: '2027-03-01T00:00:00.000Z', active: true },
  { code: 'BESTBUY15', merchant_id: 'm-bb', discount_type: 'fixed', discount_value: 15, valid_until: '2027-03-01T00:00:00.000Z', active: true },
  { code: 'EXPIRED50', merchant_id: 'm-amazon', discount_type: 'percentage', discount_value: 50, valid_until: '2020-01-01T00:00:00.000Z', active: true },
];

const CASHBACK: Row[] = [
  { merchant_id: 'm-amazon', product_id: 'p1', title: '5% cashback at Amazon', cashback_type: 'percentage', cashback_value: 5, end_at: '2027-03-01T00:00:00.000Z', active: true, deleted_at: null },
];

function stub(overrides: Record<string, Row[]> = {}): AnySupabaseClient {
  return createStubSupabase({
    products: PRODUCTS,
    merchants: MERCHANTS,
    merchant_products: MERCHANT_PRODUCTS,
    price_history: PRICE_HISTORY,
    reviews: [],
    coupons: COUPONS,
    cashback_offers: CASHBACK,
    ...overrides,
  });
}

describe('couponsAssistant — named product', () => {
  it('answers "any coupon for MacBook?" from the tables, with validity labels', async () => {
    const answer = await couponsAssistant(
      stub(),
      'any coupon for MacBook?',
      parseSearchIntent('any coupon for MacBook?'),
      FALLBACK_REGION
    );
    expect(answer.content).toContain('MacBook Air 13');
    expect(answer.content).toContain('SAVE10');
    expect(answer.content).toContain('10% off');
    expect(answer.content).toContain('valid until');
    expect(answer.content).toContain('5% cashback');
    // The expired code is never listed, and no code is invented.
    expect(answer.content).not.toContain('EXPIRED50');
    expect(answer.metadata?.products.map((p) => p.id)).toEqual(['p1']);
  });

  it('answers cashback questions for the named product', async () => {
    const answer = await couponsAssistant(
      stub(),
      'any cashback for MacBook Air 13?',
      parseSearchIntent('any cashback for MacBook Air 13?'),
      FALLBACK_REGION
    );
    expect(answer.content).toContain('5% cashback at Amazon');
  });

  it('says so honestly when the named product has no valid coupon or cashback', async () => {
    const answer = await couponsAssistant(
      stub(),
      'any coupon for Dell XPS 13?',
      parseSearchIntent('any coupon for Dell XPS 13?'),
      FALLBACK_REGION
    );
    // Dell's best retailer is Amazon, which has SAVE10 — so the
    // coupon line appears; cashback is per-product, so Dell has none.
    expect(answer.content).toContain('Dell XPS 13');
    expect(answer.content).toContain('SAVE10');
    expect(answer.content).toContain('No cashback offer is currently listed');
  });

  it('falls back to the general coupon list for an unknown product (real codes only)', async () => {
    const answer = await couponsAssistant(
      stub(),
      'any coupon for Toaster 3000?',
      parseSearchIntent('any coupon for Toaster 3000?'),
      FALLBACK_REGION
    );
    // No product matched, so the merchant-wide list is shown — the
    // codes are real table rows, never invented for the unknown name.
    expect(answer.content).toContain('SAVE10');
    expect(answer.content).toContain('Cashback offers are per product');
    expect(answer.content).not.toContain('EXPIRED50');
  });
});

describe('couponsAssistant — no product named', () => {
  it('lists currently-valid merchant coupons ("any coupons?")', async () => {
    const answer = await couponsAssistant(
      stub(),
      'any coupons?',
      parseSearchIntent('any coupons?'),
      FALLBACK_REGION
    );
    expect(answer.content).toContain('SAVE10');
    expect(answer.content).toContain('BESTBUY15');
    expect(answer.content).not.toContain('EXPIRED50');
    expect(answer.content).toContain('Cashback offers are per product');
  });

  it('filters to the named merchant ("any Best Buy coupons?")', async () => {
    const answer = await couponsAssistant(
      stub(),
      'any Best Buy coupons?',
      parseSearchIntent('any Best Buy coupons?'),
      FALLBACK_REGION
    );
    expect(answer.content).toContain('BESTBUY15');
    expect(answer.content).not.toContain('SAVE10');
  });

  it('says so honestly when no coupon is currently valid', async () => {
    const expiredOnly = stub({
      coupons: [
        { code: 'EXPIRED50', merchant_id: 'm-amazon', discount_type: 'percentage', discount_value: 50, valid_until: '2020-01-01T00:00:00.000Z', active: true },
      ],
    });
    const answer = await couponsAssistant(
      expiredOnly,
      'any coupons?',
      parseSearchIntent('any coupons?'),
      FALLBACK_REGION
    );
    expect(answer.content).toContain("don't see any currently-valid coupons");
    expect(answer.content).not.toContain('EXPIRED50');
    expect(answer.metadata).toBeNull();
  });
});

describe('generateChatResponse routes coupon intent first', () => {
  it('routes "any coupon for MacBook?" to couponsAssistant, not compare/deals', async () => {
    const answer = await generateChatResponse(stub(), 'any coupon for MacBook?', [], {});
    expect(answer.content).toContain('SAVE10');
    expect(answer.content).toContain('valid until');
  });

  it('routes "discount code" questions to couponsAssistant', async () => {
    const answer = await generateChatResponse(stub(), 'discount code for MacBook?', [], {});
    expect(answer.content).toContain('SAVE10');
  });

  it('still routes compare questions to the compare handler', async () => {
    const answer = await generateChatResponse(
      stub(),
      'compare MacBook Air 13 vs Dell XPS 13',
      [],
      {}
    );
    expect(answer.content.toLowerCase()).toContain('compare');
    expect(answer.content).toContain('MacBook Air 13');
    expect(answer.content).toContain('Dell XPS 13');
  });

  it('still routes general questions to recommendations', async () => {
    const answer = await generateChatResponse(stub(), 'best laptop under $1000', [], {});
    expect(answer.content).toContain('Lowest price pick');
  });
});
