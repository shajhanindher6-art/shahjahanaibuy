/**
 * Section 19, Phase 0 (§12 #52) — buy/wait verdict in the assistant.
 *
 * "Should I buy now or wait?" used to fall through to
 * recommendAssistant() and was answered as a generic product
 * search. It now routes to buyWaitAssistant, which answers from
 * the existing deterministic buy-vs-wait engine
 * (services/buy-wait-prediction) over the product's real recorded
 * price_history points — verdict + transparent explanation,
 * labelled an estimate, never a guarantee.
 *
 * The Supabase client is the same small chainable stub pattern as
 * tests/chat-coupons.test.ts (thenable builder with eq / neq / or
 * / in / is / order / limit / maybeSingle), seeded with the same
 * demo rows plus multi-point price histories: MacBook falls to its
 * low (Buy Now), Dell rises (Wait), Mystery Gadget has one point
 * (not enough data).
 */

import { describe, expect, it } from 'vitest';
import { buyWaitAssistant } from '@/services/personal-assistant';
import { generateChatResponse } from '@/services/chat';
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
  {
    id: 'p3',
    name: 'Mystery Gadget',
    slug: 'mystery-gadget',
    brand: null,
    category: 'Gadgets',
    image_url: null,
    confidence_score: 50,
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
  { product_id: 'p3', merchant_id: 'm-amazon', price: 50, compare_at_price: null, url: null, in_stock: true, deleted_at: null },
];

// MacBook: falls to its recorded low (Buy Now). Dell: rises (Wait).
// Mystery Gadget: a single point (not enough data).
// 5 points each for MacBook/Dell — the Section 20 (§12 #46)
// buy-wait minimum: 4 points would return "Not enough data".
const PRICE_HISTORY: Row[] = [
  { product_id: 'p1', price: 1099, recorded_at: '2026-10-01T00:00:00.000Z' },
  { product_id: 'p1', price: 1049, recorded_at: '2026-10-15T00:00:00.000Z' },
  { product_id: 'p1', price: 999, recorded_at: '2026-11-02T00:00:00.000Z' },
  { product_id: 'p1', price: 999, recorded_at: '2026-11-10T00:00:00.000Z' },
  { product_id: 'p1', price: 999, recorded_at: '2026-11-11T00:00:00.000Z' },
  { product_id: 'p2', price: 999, recorded_at: '2026-10-01T00:00:00.000Z' },
  { product_id: 'p2', price: 1049, recorded_at: '2026-10-15T00:00:00.000Z' },
  { product_id: 'p2', price: 1099, recorded_at: '2026-11-02T00:00:00.000Z' },
  { product_id: 'p2', price: 1099, recorded_at: '2026-11-10T00:00:00.000Z' },
  { product_id: 'p2', price: 1099, recorded_at: '2026-11-11T00:00:00.000Z' },
  { product_id: 'p3', price: 50, recorded_at: '2026-11-10T00:00:00.000Z' },
];

function stub(): AnySupabaseClient {
  return createStubSupabase({
    products: PRODUCTS,
    merchants: MERCHANTS,
    merchant_products: MERCHANT_PRODUCTS,
    price_history: PRICE_HISTORY,
    reviews: [],
    coupons: [],
    cashback_offers: [],
  });
}

describe('buyWaitAssistant — verdict from recorded price history', () => {
  it('MacBook at its recorded low → "Buy Now" with explanation, confidence, and the estimate label', async () => {
    const answer = await buyWaitAssistant(
      stub(),
      'should I buy the MacBook Air 13 now or wait?',
      FALLBACK_REGION
    );
    expect(answer.content).toContain('Verdict for MacBook Air 13: Buy Now');
    expect(answer.content).toContain('at or near the lowest recorded price');
    // 5 recorded points → the 5–11-point confidence tier (45%),
    // no longer the thin-history 25% / "low — only 4 recorded
    // prices" label of the old 4-point fixture.
    expect(answer.content).toContain('Confidence: 45%');
    expect(answer.content).not.toContain('low — only');
    expect(answer.content).toContain('not a guarantee');
    expect(answer.content).toContain('Current: $999.00');
    expect(answer.content).toContain('Lowest recorded: $999.00');
    // A verdict, not a generic product search.
    expect(answer.content).not.toContain('Best pick');
    expect(answer.metadata?.intent).toBe('buy_wait');
    expect(answer.metadata?.products.map((p) => p.id)).toEqual(['p1']);
  });

  it('Dell on a rising trend → "Wait" with the trend reason', async () => {
    const answer = await buyWaitAssistant(
      stub(),
      'should I buy the Dell XPS 13 now or wait?',
      FALLBACK_REGION
    );
    expect(answer.content).toContain('Verdict for Dell XPS 13: Wait');
    expect(answer.content).toContain('rising');
    expect(answer.content).toContain('not a guarantee');
    expect(answer.metadata?.products.map((p) => p.id)).toEqual(['p2']);
  });

  it('one recorded price → "Not enough data", no verdict invented', async () => {
    const answer = await buyWaitAssistant(
      stub(),
      'should I buy the Mystery Gadget now or wait?',
      FALLBACK_REGION
    );
    expect(answer.content).toContain('Verdict for Mystery Gadget: Not enough data');
    expect(answer.content).toContain('Not enough price history to predict');
    expect(answer.content).toContain('only 1 recorded price so far (at least 5 are needed)');
    expect(answer.content).not.toContain('Confidence:');
  });

  it('no product named → asks which product instead of guessing', async () => {
    const answer = await buyWaitAssistant(stub(), 'should I buy now or wait?', FALLBACK_REGION);
    expect(answer.content).toContain('which product');
    expect(answer.content).not.toContain('Verdict for');
    expect(answer.metadata).toBeNull();
  });
});

describe('generateChatResponse routes buy/wait questions to the verdict handler', () => {
  it('routes "should I buy the MacBook Air 13 now or wait?" to buyWaitAssistant', async () => {
    const answer = await generateChatResponse(
      stub(),
      'should I buy the MacBook Air 13 now or wait?',
      [],
      {}
    );
    expect(answer.content).toContain('Verdict for MacBook Air 13: Buy Now');
    expect(answer.content).not.toContain('Best pick');
  });

  it('routes "is now a good time to buy" to the verdict handler', async () => {
    const answer = await generateChatResponse(
      stub(),
      'is now a good time to buy the Dell XPS 13?',
      [],
      {}
    );
    expect(answer.content).toContain('Verdict for Dell XPS 13: Wait');
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
