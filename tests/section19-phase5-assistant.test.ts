/**
 * Section 19, Phase 5 (§12 #53/#54/#55/#56) — shopping assistant:
 * competitiveness answer, pros/cons handler, source labelling, and
 * conversational follow-ups.
 *
 * Competitiveness is judged from the product's own recorded low /
 * average / high + its merchant listings, with the price freshness
 * stated. Pros/cons come from the REAL ai-summary output (Phase 0/2
 * made it honest) + real recorded signals — with 0 reviews + 0
 * specs the handler says what isn't known instead of inventing
 * pros/cons. Follow-ups resolve against the previous turn's
 * products from the session history (dashboard chat), not from a
 * guess. The stub is the same chainable-builder pattern as
 * tests/section19-chat-buy-wait.test.ts, extended with gt/insert/
 * delete/single for the services these handlers call.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  competitivenessAssistant,
  prosConsAssistant,
} from '@/services/personal-assistant';
import {
  extractSessionContext,
  generateChatResponse,
  type ChatMessage,
} from '@/services/chat';
import { resolveFollowUpQuery } from '@/lib/deal-finder-stream';
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
  {
    id: 'p3', name: 'Mystery Gadget', slug: 'mystery-gadget', description: null,
    brand: null, category: 'Gadgets', image_url: null, gtin: null,
    confidence_score: 50, data_freshness: '2026-11-10T00:00:00.000Z',
    created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z',
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

// MacBook: falls to its recorded low. Dell: rises to its high.
// Mystery Gadget: a single point (not enough history to judge).
// Section 20, §12 #46: a competitiveness verdict needs at least
// 5 recorded points — so MacBook and Dell each carry 5.
const PRICE_HISTORY: Row[] = [
  { product_id: 'p1', price: 1099, recorded_at: '2026-10-01T00:00:00.000Z' },
  { product_id: 'p1', price: 1049, recorded_at: '2026-10-15T00:00:00.000Z' },
  { product_id: 'p1', price: 1049, recorded_at: '2026-10-22T00:00:00.000Z' },
  { product_id: 'p1', price: 999, recorded_at: '2026-11-02T00:00:00.000Z' },
  { product_id: 'p1', price: 999, recorded_at: '2026-11-10T00:00:00.000Z' },
  { product_id: 'p2', price: 999, recorded_at: '2026-10-01T00:00:00.000Z' },
  { product_id: 'p2', price: 1049, recorded_at: '2026-10-15T00:00:00.000Z' },
  { product_id: 'p2', price: 1099, recorded_at: '2026-10-22T00:00:00.000Z' },
  { product_id: 'p2', price: 1099, recorded_at: '2026-11-02T00:00:00.000Z' },
  { product_id: 'p2', price: 1099, recorded_at: '2026-11-10T00:00:00.000Z' },
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
    ai_summaries: [],
    product_attributes: [],
    product_variants: [],
  });
}

describe('competitivenessAssistant — verdict from recorded history + merchants', () => {
  it('MacBook at its recorded low → competitive, with merchant comparison and freshness', async () => {
    const answer = await competitivenessAssistant(
      stub(),
      'is the price of MacBook Air 13 competitive?',
      FALLBACK_REGION
    );
    expect(answer.content).toContain('Is the price of MacBook Air 13 competitive?');
    // Section 20, §12 #82: the price is RECORDED, never "verified"
    // — no product in this catalog carries a verified stamp.
    expect(answer.content).toContain('Current recorded price: $999.00');
    expect(answer.content).toContain('2 merchants list this product');
    expect(answer.content).toContain('Cheapest: Amazon at $999.00');
    expect(answer.content).toContain('most expensive: Best Buy at $1,018.98');
    expect(answer.content).toContain('lowest $999.00');
    expect(answer.content).toContain('Verdict: yes — competitive. It is at its lowest recorded price right now.');
    expect(answer.content).toContain('Price last checked Nov 12, 2026');
    expect(answer.metadata?.intent).toBe('price_competitiveness');
    expect(answer.metadata?.products.map((p) => p.id)).toEqual(['p1']);
  });

  it('Dell near its recorded high → not competitive right now', async () => {
    const answer = await competitivenessAssistant(
      stub(),
      'is the Dell XPS 13 price competitive?',
      FALLBACK_REGION
    );
    expect(answer.content).toContain('Verdict: not competitive right now — near its highest recorded price.');
    expect(answer.content).toContain('Only one merchant lists this product');
  });

  it('one history point → honest not-enough-data, never a verdict on zero evidence', async () => {
    const answer = await competitivenessAssistant(
      stub(),
      'is the price of Mystery Gadget competitive?',
      FALLBACK_REGION
    );
    expect(answer.content).toContain("don't have enough recorded price history");
    // Section 20, §12 #46: the honest count is named — 1 point
    // exists, it is just not enough to judge (needs 5).
    expect(answer.content).toContain('only 1 recorded price point so far');
    expect(answer.content).not.toContain('Verdict: yes');
    expect(answer.content).not.toContain('Verdict: not competitive');
  });

  it('no product named → asks which product', async () => {
    const answer = await competitivenessAssistant(
      stub(),
      'is this price competitive?',
      FALLBACK_REGION
    );
    expect(answer.content).toContain('which product?');
  });
});

describe('prosConsAssistant — real ai-summary output + recorded signals only', () => {
  it('0 reviews + 0 specs → real pros/cons plus an explicit what-isn\'t-known', async () => {
    const answer = await prosConsAssistant(
      stub(),
      'what are the pros and cons of MacBook Air 13?',
      FALLBACK_REGION
    );
    expect(answer.content).toContain('Pros and cons of MacBook Air 13:');
    // Real pros from the ai-summary output (near-low price only).
    // Section 20, §12 #83: the old "From established brand: Apple"
    // pro is REMOVED — a brand name alone is not evidence of
    // quality, so no brand-reputation claim may appear here.
    expect(answer.content).not.toContain('From established brand');
    expect(answer.content).toContain('Currently near its lowest recorded price');
    // Recorded signals, kept separate.
    expect(answer.content).toContain('From recorded data:');
    expect(answer.content).toContain('At its lowest recorded price ($999.00).');
    expect(answer.content).toContain('No reviews are recorded for this product.');
    // What isn't known is named, never papered over.
    expect(answer.content).toContain("What isn't known:");
    expect(answer.content).toContain('real buyer experience (no reviews recorded)');
    expect(answer.content).toContain('no specifications recorded');
    // Never invented: no reputation claim, no clean bill of health.
    expect(answer.content).not.toContain('reputable brand');
    expect(answer.content).not.toContain('No significant drawbacks');
    expect(answer.metadata?.intent).toBe('pros_cons');
    expect(answer.metadata?.products.map((p) => p.id)).toEqual(['p1']);
  });

  it('no product named → asks which product', async () => {
    const answer = await prosConsAssistant(stub(), 'pros and cons?', FALLBACK_REGION);
    expect(answer.content).toContain('which product?');
  });
});

describe('generateChatResponse — routing + source label (#53/#54/#55)', () => {
  it('competitiveness question routes to the verdict, not a product search', async () => {
    const answer = await generateChatResponse(
      stub(),
      'is the price of MacBook Air 13 competitive?',
      [],
      {}
    );
    expect(answer.content).toContain('Is the price of MacBook Air 13 competitive?');
    expect(answer.content).toContain('Verdict: yes — competitive.');
    expect(answer.content).not.toContain('Best pick for you');
  });

  it('pros/cons question routes to the pros/cons handler', async () => {
    const answer = await generateChatResponse(
      stub(),
      'what are the pros and cons of MacBook Air 13?',
      [],
      {}
    );
    expect(answer.content).toContain('Pros and cons of MacBook Air 13:');
    expect(answer.content).not.toContain('Best pick for you');
  });

  it('every assistant answer carries the recorded-data source label (#55, §12 #82)', async () => {
    const answer = await generateChatResponse(stub(), 'best laptop under $1000', [], {});
    expect(answer.content).toContain('Lowest price pick for you: MacBook Air 13');
    // Section 20, §12 #82: verifiedDataLabel only when every
    // product is verified AND fresh — this catalog is unverified,
    // so the recorded-data label is the honest one.
    expect(answer.content).toContain(
      'Source: based on recorded catalog data from the SmartBuy catalog (prices last checked Nov 12, 2026 — recorded prices, not checked live at the merchant)'
    );
    expect(answer.content).not.toContain('based on verified recorded data');
  });

  it('a single-product answer labels the data with its real freshness timestamp', async () => {
    const answer = await generateChatResponse(
      stub(),
      'is the price of MacBook Air 13 competitive?',
      [],
      {}
    );
    expect(answer.content).toContain('Source: based on recorded catalog data');
    expect(answer.content).toContain('prices last checked Nov 12, 2026');
  });
});

describe('conversational follow-ups (#56) — session context resolves the previous product', () => {
  const history: ChatMessage[] = [
    {
      id: 'u1',
      conversationId: 'c1',
      role: 'user',
      content: 'best laptop under $1200',
      metadata: null,
      createdAt: '2026-11-12T00:00:00.000Z',
    },
    {
      id: 'a1',
      conversationId: 'c1',
      role: 'assistant',
      content:
        '🏆 Best pick for you: MacBook Air 13 (Apple)\nPrice: $999.00 at Amazon — In Stock.',
      metadata: {
        products: [
          { id: 'p1', name: 'MacBook Air 13', slug: 'macbook-air-13', brand: 'Apple', imageUrl: null, price: 999 },
          { id: 'p2', name: 'Dell XPS 13', slug: 'dell-xps-13', brand: 'Dell', imageUrl: null, price: 1099 },
        ],
        intent: 'recommend',
      },
      createdAt: '2026-11-12T00:00:01.000Z',
    },
  ];

  it('extractSessionContext reads the last turn\'s products + intent from metadata', () => {
    const context = extractSessionContext(history);
    expect(context.productNames).toEqual(['MacBook Air 13', 'Dell XPS 13']);
    expect(context.lastIntent).toBe('recommend');
  });

  it('"and the cheaper one?" resolves against the previous products and compares them', async () => {
    const answer = await generateChatResponse(stub(), 'and the cheaper one?', history, {});
    expect(answer.content).toContain('MacBook Air 13');
    expect(answer.content).toContain('Dell XPS 13');
    expect(answer.content).toContain('Lowest price pick: MacBook Air 13');
  });

  it('"is it competitive?" resolves against the previous single product', async () => {
    const singleHistory: ChatMessage[] = [
      {
        id: 'a1',
        conversationId: 'c1',
        role: 'assistant',
        content: '🏆 Best pick for you: MacBook Air 13 (Apple)\nPrice: $999.00 at Amazon — In Stock.',
        metadata: {
          products: [
            { id: 'p1', name: 'MacBook Air 13', slug: 'macbook-air-13', brand: 'Apple', imageUrl: null, price: 999 },
          ],
          intent: 'recommend',
        },
        createdAt: '2026-11-12T00:00:01.000Z',
      },
    ];
    const answer = await generateChatResponse(stub(), 'is it competitive?', singleHistory, {});
    expect(answer.content).toContain('Is the price of MacBook Air 13 competitive?');
    expect(answer.content).toContain('Verdict: yes — competitive.');
  });

  it('a fresh question naming its own category is NOT rewritten against the previous products', async () => {
    const answer = await generateChatResponse(stub(), 'cheapest headphones', history, {});
    expect(answer.content).not.toContain('Compare MacBook Air 13');
    expect(answer.content).not.toContain('Best pick: MacBook Air 13');
  });

  it('resolveFollowUpQuery gains pros/cons + competitive rewrites', () => {
    expect(resolveFollowUpQuery('and its pros and cons?', ['MacBook Air 13'])).toBe(
      'What are the pros and cons of MacBook Air 13?'
    );
    expect(resolveFollowUpQuery('is it competitive?', ['MacBook Air 13'])).toBe(
      'Is the price of MacBook Air 13 competitive?'
    );
    expect(
      resolveFollowUpQuery('pros and cons?', ['MacBook Air 13', 'Dell XPS 13'])
    ).toBe('What are the pros and cons of MacBook Air 13, Dell XPS 13?');
  });
});

describe('dashboard chat panel — follow-up chips mirroring the widget (#56)', () => {
  it('renders follow-up chips and passes contextProducts with the request', () => {
    const source = readFileSync(
      join(process.cwd(), 'components', 'dashboard', 'ai-chat-panel.tsx'),
      'utf8'
    );
    expect(source).toContain('Sab se sasta kaunsa hai?');
    expect(source).toContain('Pros and cons?');
    expect(source).toContain('Is the price competitive?');
    expect(source).toContain('contextProducts');
    expect(source).toContain('followUpChips');
  });
});
