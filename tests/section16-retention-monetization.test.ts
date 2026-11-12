/**
 * Section 16, #30–#38 — Retention & monetization code.
 *
 * Covers:
 *  #30 discount sort (ai-search discount-desc + discountPercent,
 *      getLowestMerchantPrices compare-at plumbing)
 *  #31 admin newsletter send route (admin-only, fail-closed 503s)
 *  #32 saved-search match notifications (matcher, opt-in toggle,
 *      refresh-chain notifier, PATCH route)
 *  #33 simulator → real alert (file wiring — the button POSTs the
 *      existing /api/v1/alerts; the API itself is covered by the
 *      alerts tests)
 *  #34 admin affiliate-clicks report — ALREADY BUILT (API +
 *      admin tab); asserted here by file, not rebuilt
 *  #35 push opt-in after alert creation (file wiring)
 *  #36 saved calculations (share-URL helpers, validation, service,
 *      migration-file assertions)
 *  #37 typo tolerance + synonym expansion (ai-search)
 *  #38 recently-viewed sync (GET /api/v1/product-views)
 *
 * Route/service tests run against mocked Supabase clients and
 * mocked middleware (admin/auth stubs); no DB, no network. The
 * ai-search tests reuse the Section 15 fuzzy test's fake-client
 * shape (chainable builder simulating PostgREST ilike matching).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import {
  aiSearch,
  computeTokenMatches,
  expandSearchTokens,
  parseSearchIntent,
  tokenMatchesWordFuzzy,
} from '@/services/ai-search';
import { getLowestMerchantPrices } from '@/services/products';
import {
  findSavedSearchMatches,
  notifySavedSearchMatches,
  setSavedSearchNotify,
  type SavedSearchMatchProduct,
} from '@/services/saved-searches';
import {
  buildCalculationShareUrl,
  isSavedCalculationTool,
  parseCalculationShareParams,
} from '@/lib/saved-calculations';
import {
  createSavedCalculation,
  listSavedCalculations,
  validateSavedCalculationInput,
} from '@/services/saved-calculations';
import type { AnySupabaseClient } from '@/lib/supabase/types';

function readRepo(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// Shared fakes
// ---------------------------------------------------------------------------

const missingTableError = {
  code: '42P01',
  message: 'relation "public.saved_searches" does not exist',
};

// --- ai-search fake client -------------------------------------------------

interface CatalogRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  gtin: string | null;
  confidence_score: number;
  data_freshness: string;
  created_at: string;
  updated_at: string;
}

function productRow(
  id: string,
  name: string,
  slug: string,
  brand: string,
  category: string,
  description: string
): CatalogRow {
  return {
    id,
    name,
    slug,
    description,
    brand,
    category,
    image_url: null,
    gtin: null,
    confidence_score: 50,
    data_freshness: '2026-11-02T07:13:52.000Z',
    created_at: '2026-11-02T07:13:52.000Z',
    updated_at: '2026-11-02T07:13:52.000Z',
  };
}

const SEARCH_CATALOG: CatalogRow[] = [
  productRow('p-macbook', 'MacBook Air 13', 'macbook-air-13', 'Apple', 'laptop', 'Lightweight laptop with M2 chip'),
  productRow('p-galaxy', 'Samsung Galaxy S24', 'samsung-galaxy-s24', 'Samsung', 'phone', 'Android smartphone'),
  productRow('p-sony', 'Sony WH-1000XM5', 'sony-wh-1000xm5', 'Sony', 'headphones', 'Noise cancelling headphones'),
];

interface MerchantRow {
  product_id: string;
  merchant_id: string;
  price: number;
  compare_at_price: number | null;
}

const SEARCH_MERCHANT_ROWS: MerchantRow[] = [
  { product_id: 'p-macbook', merchant_id: 'm-amazon', price: 999, compare_at_price: 1099 },
  { product_id: 'p-macbook', merchant_id: 'm-bestbuy', price: 1049, compare_at_price: 1099 },
  { product_id: 'p-galaxy', merchant_id: 'm-amazon', price: 799, compare_at_price: 799 },
  { product_id: 'p-sony', merchant_id: 'm-amazon', price: 349, compare_at_price: 399 },
  { product_id: 'p-sony', merchant_id: 'm-bestbuy', price: 379, compare_at_price: 399 },
];

function makeSearchClient(catalog: CatalogRow[], merchantRows: MerchantRow[]) {
  function builder(table: string) {
    const b: Record<string, unknown> = {
      _cols: '',
      _ors: [] as string[],
      _ilike: '',
      select: (cols?: string) => {
        b._cols = cols ?? '';
        return b;
      },
      is: () => b,
      neq: () => b,
      eq: () => b,
      in: () => b,
      gt: () => b,
      order: () => b,
      limit: () => b,
      or: (clause: string) => {
        (b._ors as string[]).push(clause);
        return b;
      },
      ilike: (_col: string, pattern: string) => {
        b._ilike = pattern;
        return b;
      },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => void) => {
        if (table === 'merchant_products') {
          resolve({ data: merchantRows, error: null });
          return;
        }
        if (table !== 'products') {
          resolve({ data: [], error: null });
          return;
        }
        if (b._cols === 'name, brand, category') {
          resolve({ data: catalog, error: null });
          return;
        }
        let rows = catalog.filter((r) => r.slug !== 'sample-laptop');
        const orClauses = b._ors as string[];
        if (orClauses.length > 0) {
          const tokens = orClauses
            .flatMap((c) => [...c.matchAll(/%([^%]+)%/g)].map((m) => m[1].toLowerCase()));
          rows = rows.filter((r) => {
            const hay = [r.name, r.description ?? '', r.brand ?? '', r.category ?? '']
              .join(' ')
              .toLowerCase();
            return tokens.some((t) => hay.includes(t));
          });
        }
        const ilikePattern = b._ilike as string;
        if (ilikePattern) {
          const pat = ilikePattern.replace(/%/g, '').toLowerCase();
          rows = rows.filter((r) => (r.category ?? '').toLowerCase().includes(pat));
        }
        resolve({ data: rows, error: null });
      },
    };
    return b;
  }
  return { from: (table: string) => builder(table) } as unknown as AnySupabaseClient;
}

// ---------------------------------------------------------------------------
// #37 — typo tolerance + synonyms (pure)
// ---------------------------------------------------------------------------

describe('expandSearchTokens (Section 16, #37)', () => {
  it('appends the canonical synonym and keeps the typed token first', () => {
    expect(expandSearchTokens(['notebook'])).toEqual(['notebook', 'laptop']);
    expect(expandSearchTokens(['smartphone'])).toEqual(['smartphone', 'phone']);
    expect(expandSearchTokens(['earbuds'])).toEqual(['earbuds', 'headphones']);
    expect(expandSearchTokens(['television'])).toEqual(['television', 'tv']);
  });

  it('does not duplicate when the canonical word is already present', () => {
    expect(expandSearchTokens(['laptop'])).toEqual(['laptop']);
    expect(expandSearchTokens(['laptop', 'notebook'])).toEqual(['laptop', 'notebook']);
  });

  it('leaves unknown tokens untouched', () => {
    expect(expandSearchTokens(['macbook', 'air'])).toEqual(['macbook', 'air']);
  });
});

describe('tokenMatchesWordFuzzy (Section 16, #37)', () => {
  it('matches a 1-edit typo on a 4–5 letter token', () => {
    expect(tokenMatchesWordFuzzy('macbok', 'macbook')).toBe(true);
    expect(tokenMatchesWordFuzzy('samsng', 'samsung')).toBe(true);
  });

  it('matches a 2-edit typo only on tokens of 6+ letters', () => {
    expect(tokenMatchesWordFuzzy('hedphones', 'headphones')).toBe(true);
    // 'macbk' is 2 edits from 'macbook' (two missing o's) but only
    // 5 letters, so the 2-edit allowance (6+ letters) does not
    // apply. (The previous negative example, 'hedpones', was
    // wrong: it is 8 letters and exactly 2 edits from
    // 'headphones', so the documented rule says it MUST match.)
    expect(tokenMatchesWordFuzzy('macbk', 'macbook')).toBe(false);
  });

  it('never fuzzy-matches tokens shorter than 4 letters', () => {
    expect(tokenMatchesWordFuzzy('air', 'aip')).toBe(false);
    expect(tokenMatchesWordFuzzy('tv', 'tx')).toBe(false);
  });
});

describe('computeTokenMatches typo tolerance (Section 16, #37)', () => {
  const macbook = {
    name: 'MacBook Air 13',
    brand: 'Apple',
    category: 'laptop',
    description: 'Lightweight laptop with M2 chip',
  };
  it('matches a typoed token against the product name', () => {
    const { matchedTerms, nameMatchedTerms } = computeTokenMatches(['macbok'], macbook);
    expect(matchedTerms).toEqual(['macbok']);
    expect(nameMatchedTerms).toEqual(['macbok']);
  });

  it('still matches exact tokens and does not match unrelated words', () => {
    expect(computeTokenMatches(['macbook'], macbook).matchedTerms).toEqual(['macbook']);
    expect(computeTokenMatches(['zzzqqq'], macbook).matchedTerms).toEqual([]);
  });
});

describe('aiSearch synonyms (Section 16, #37)', () => {
  it('"notebook" finds laptops via the synonym expansion', async () => {
    const client = makeSearchClient(SEARCH_CATALOG, SEARCH_MERCHANT_ROWS);
    const result = await aiSearch(client, { query: 'notebook' });
    expect(result.total).toBe(1);
    expect(result.results[0].product.slug).toBe('macbook-air-13');
  });

  it('"smartphone" finds phones', async () => {
    const client = makeSearchClient(SEARCH_CATALOG, SEARCH_MERCHANT_ROWS);
    const result = await aiSearch(client, { query: 'smartphone' });
    expect(result.total).toBe(1);
    expect(result.results[0].product.slug).toBe('samsung-galaxy-s24');
  });
});

// ---------------------------------------------------------------------------
// #30 — discount sort
// ---------------------------------------------------------------------------

describe('aiSearch discount-desc sort (Section 16, #30)', () => {
  it('returns the recorded discount per product and sorts biggest first', async () => {
    const client = makeSearchClient(SEARCH_CATALOG, SEARCH_MERCHANT_ROWS);
    // 'a' tokenizes to nothing, so the candidate set is the whole catalog.
    const result = await aiSearch(client, { query: 'a', sort: 'discount-desc' });
    expect(result.total).toBe(3);
    // Sony 349 vs 399 = 12.5%; MacBook 999 vs 1099 = 9.1% (best of
    // its two rows); Galaxy 799 vs 799 = no saving → null, last.
    expect(result.results[0].product.slug).toBe('sony-wh-1000xm5');
    expect(result.results[0].discountPercent).toBe(12.5);
    expect(result.results[1].product.slug).toBe('macbook-air-13');
    expect(result.results[1].discountPercent).toBe(9.1);
    expect(result.results[2].product.slug).toBe('samsung-galaxy-s24');
    expect(result.results[2].discountPercent).toBeNull();
  });

  it('reports null discounts (not 0%) when no compare-at price exists', async () => {
    const client = makeSearchClient(SEARCH_CATALOG, []);
    const result = await aiSearch(client, { query: 'a', sort: 'discount-desc' });
    expect(result.results.every((r) => r.discountPercent === null)).toBe(true);
  });
});

describe('getLowestMerchantPrices compare-at plumbing (Section 16, #30)', () => {
  function makePricesClient(rows: MerchantRow[]) {
    return {
      from: () => ({
        select: () => ({
          in: () => ({
            is: () => ({
              eq: () => ({
                order: () => ({
                  then: (resolve: (v: unknown) => void) =>
                    resolve({ data: rows, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as AnySupabaseClient;
  }

  it('carries the cheapest row compare-at price and its discount', async () => {
    const client = makePricesClient(SEARCH_MERCHANT_ROWS);
    const prices = await getLowestMerchantPrices(client, ['p-macbook', 'p-sony', 'p-galaxy']);
    expect(prices.get('p-macbook')).toEqual({
      price: 999,
      merchantCount: 2,
      compareAtPrice: 1099,
      discountPercent: 9.1,
    });
    expect(prices.get('p-sony')).toEqual({
      price: 349,
      merchantCount: 2,
      compareAtPrice: 399,
      discountPercent: 12.5,
    });
    // Galaxy's compare-at equals its price → no saving, null discount.
    expect(prices.get('p-galaxy')).toEqual({
      price: 799,
      merchantCount: 1,
      compareAtPrice: 799,
      discountPercent: null,
    });
  });

  it('returns null compare-at/discount when the row carries none', async () => {
    const client = makePricesClient([
      { product_id: 'p-macbook', merchant_id: 'm-amazon', price: 999, compare_at_price: null },
    ]);
    const prices = await getLowestMerchantPrices(client, ['p-macbook']);
    expect(prices.get('p-macbook')).toEqual({
      price: 999,
      merchantCount: 1,
      compareAtPrice: null,
      discountPercent: null,
    });
  });
});

// ---------------------------------------------------------------------------
// #32 — saved-search match notifications
// ---------------------------------------------------------------------------

const MATCH_PRODUCTS: SavedSearchMatchProduct[] = [
  {
    id: 'p-macbook',
    name: 'MacBook Air 13',
    slug: 'macbook-air-13',
    brand: 'Apple',
    category: 'laptop',
    description: 'Lightweight laptop with M2 chip',
    createdAt: '2026-11-05T09:00:00.000Z',
  },
  {
    id: 'p-galaxy',
    name: 'Samsung Galaxy S24',
    slug: 'samsung-galaxy-s24',
    brand: 'Samsung',
    category: 'phone',
    description: 'Android smartphone',
    createdAt: '2026-10-01T09:00:00.000Z',
  },
  {
    id: 'p-sony',
    name: 'Sony WH-1000XM5',
    slug: 'sony-wh-1000xm5',
    brand: 'Sony',
    category: 'headphones',
    description: 'Noise cancelling headphones',
    createdAt: '2026-11-06T09:00:00.000Z',
  },
];

describe('findSavedSearchMatches (Section 16, #32)', () => {
  const search = { query: 'q=laptop', lastNotifiedAt: '2026-11-01T00:00:00.000Z' };

  it('matches only NEW products whose text carries every q token', () => {
    const matches = findSavedSearchMatches(search, MATCH_PRODUCTS);
    expect(matches.map((p) => p.id)).toEqual(['p-macbook']);
  });

  it('excludes products created before last_notified_at, even when they match', () => {
    const matches = findSavedSearchMatches(
      { query: 'q=phone', lastNotifiedAt: '2026-11-01T00:00:00.000Z' },
      MATCH_PRODUCTS
    );
    expect(matches).toEqual([]);
  });

  it('matches via the synonym expansion ("notebook" → laptop)', () => {
    const matches = findSavedSearchMatches(
      { query: 'q=notebook', lastNotifiedAt: null },
      MATCH_PRODUCTS
    );
    expect(matches.map((p) => p.id)).toEqual(['p-macbook']);
  });

  it('matches nothing for a search with no q, and never invents a match', () => {
    expect(
      findSavedSearchMatches({ query: 'sort=price-asc', lastNotifiedAt: null }, MATCH_PRODUCTS)
    ).toEqual([]);
    expect(
      findSavedSearchMatches({ query: 'q=zzzqqq', lastNotifiedAt: null }, MATCH_PRODUCTS)
    ).toEqual([]);
  });
});

// --- Fake saved_searches client (toggle + notifier) ------------------------

type SavedSearchRow = Record<string, unknown>;

const notifyFakeDb = vi.hoisted(() => ({
  rows: [] as SavedSearchRow[],
  products: [] as Record<string, unknown>[],
  tableMissing: false,
  updated: [] as Array<{ id: string; patch: Record<string, unknown> }>,
}));

function makeNotifyFakeClient() {
  function builder(table: string) {
    const state: {
      updatePatch?: Record<string, unknown>;
      eqFilters: Record<string, unknown>;
    } = { eqFilters: {} };
    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: () => chain,
      update: (patch: Record<string, unknown>) => {
        state.updatePatch = patch;
        return chain;
      },
      delete: () => chain,
      eq: (col: string, value: unknown) => {
        state.eqFilters[col] = value;
        return chain;
      },
      order: () => chain,
      is: () => chain,
      neq: () => chain,
      limit: () => chain,
      single: async () => {
        if (notifyFakeDb.tableMissing) return { data: null, error: missingTableError };
        if (state.updatePatch) {
          const row = notifyFakeDb.rows.find(
            (r) =>
              r.id === state.eqFilters.id && r.user_id === state.eqFilters.user_id
          );
          if (!row) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
          Object.assign(row, state.updatePatch);
          notifyFakeDb.updated.push({ id: String(row.id), patch: state.updatePatch });
          return { data: row, error: null };
        }
        return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      },
      then: (resolve: (value: unknown) => void) => {
        if (notifyFakeDb.tableMissing) {
          resolve({ data: null, error: missingTableError });
          return;
        }
        if (table === 'products') {
          resolve({ data: notifyFakeDb.products, error: null });
          return;
        }
        if (state.updatePatch) {
          const row = notifyFakeDb.rows.find((r) => r.id === state.eqFilters.id);
          if (row) {
            Object.assign(row, state.updatePatch);
            notifyFakeDb.updated.push({ id: String(row.id), patch: state.updatePatch });
          }
          resolve({ data: [], error: null });
          return;
        }
        let rows = notifyFakeDb.rows;
        if (state.eqFilters.notify_on_match === true) {
          rows = rows.filter((r) => r.notify_on_match === true);
        }
        resolve({ data: rows, error: null });
      },
    };
    return chain;
  }
  return { from: (table: string) => builder(table) } as unknown as AnySupabaseClient;
}

describe('setSavedSearchNotify (Section 16, #32)', () => {
  beforeEach(() => {
    notifyFakeDb.rows = [
      {
        id: 's-1',
        user_id: 'user-1',
        name: 'Laptops',
        query: 'q=laptop',
        notify_on_match: false,
        last_notified_at: null,
        created_at: '2026-11-01T09:00:00.000Z',
        updated_at: '2026-11-01T09:00:00.000Z',
      },
    ];
    notifyFakeDb.tableMissing = false;
    notifyFakeDb.updated = [];
  });

  it('turns notifications on and stamps last_notified_at (no old-catalog spam)', async () => {
    const client = makeNotifyFakeClient();
    const result = await setSavedSearchNotify(client, 'user-1', 's-1', true);
    expect('savedSearch' in result).toBe(true);
    if ('savedSearch' in result) {
      expect(result.savedSearch.notifyOnMatch).toBe(true);
      expect(result.savedSearch.lastNotifiedAt).not.toBeNull();
    }
    expect(notifyFakeDb.updated[0].patch.notify_on_match).toBe(true);
    expect(typeof notifyFakeDb.updated[0].patch.last_notified_at).toBe('string');
  });

  it('returns not-found for another user\'s search', async () => {
    const client = makeNotifyFakeClient();
    const result = await setSavedSearchNotify(client, 'user-2', 's-1', true);
    expect(result).toEqual({ error: 'not-found' });
  });

  it('fails closed with missing-table when migration 042 is unapplied', async () => {
    notifyFakeDb.tableMissing = true;
    const client = makeNotifyFakeClient();
    const result = await setSavedSearchNotify(client, 'user-1', 's-1', true);
    expect(result).toEqual({ error: 'missing-table' });
  });
});

describe('notifySavedSearchMatches (Section 16, #32)', () => {
  beforeEach(() => {
    notifyFakeDb.rows = [
      {
        id: 's-1',
        user_id: 'user-1',
        name: 'Laptops',
        query: 'q=laptop',
        notify_on_match: true,
        last_notified_at: '2026-11-01T00:00:00.000Z',
        created_at: '2026-11-01T09:00:00.000Z',
        updated_at: '2026-11-01T09:00:00.000Z',
      },
      {
        id: 's-2',
        user_id: 'user-2',
        name: 'Phones',
        query: 'q=phone',
        notify_on_match: false,
        last_notified_at: null,
        created_at: '2026-11-01T09:00:00.000Z',
        updated_at: '2026-11-01T09:00:00.000Z',
      },
    ];
    notifyFakeDb.products = MATCH_PRODUCTS.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      brand: p.brand,
      category: p.category,
      description: p.description,
      created_at: p.createdAt,
    }));
    notifyFakeDb.tableMissing = false;
    notifyFakeDb.updated = [];
  });

  it('queues one notification per new matching product and advances the watermark', async () => {
    const queued: Array<{ userId: string; productId: string }> = [];
    const client = makeNotifyFakeClient();
    const result = await notifySavedSearchMatches(client, async (_c, userId, _t, _ch, _s, _b, data) => {
      queued.push({ userId, productId: String((data as Record<string, unknown>).productId) });
      return true;
    });
    expect(result).toEqual({ ok: true, searchesChecked: 1, notified: 1 });
    expect(queued).toEqual([{ userId: 'user-1', productId: 'p-macbook' }]);
    // Only the notified search's watermark advanced.
    expect(notifyFakeDb.updated.map((u) => u.id)).toEqual(['s-1']);
    expect(typeof notifyFakeDb.updated[0].patch.last_notified_at).toBe('string');
  });

  it('queues nothing when no opted-in search has a new match', async () => {
    notifyFakeDb.rows[0].last_notified_at = '2026-12-01T00:00:00.000Z';
    const client = makeNotifyFakeClient();
    const result = await notifySavedSearchMatches(client, async () => {
      throw new Error('must not be called');
    });
    expect(result).toEqual({ ok: true, searchesChecked: 1, notified: 0 });
  });

  it('fails closed with table-missing when migration 042 is unapplied', async () => {
    notifyFakeDb.tableMissing = true;
    const client = makeNotifyFakeClient();
    const result = await notifySavedSearchMatches(client, async () => true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('table-missing');
    expect(result.notified).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #36 — saved calculations
// ---------------------------------------------------------------------------

describe('calculation share URLs (Section 16, #36)', () => {
  it('builds a stable, sorted shareable link and parses it back', () => {
    const url = buildCalculationShareUrl('emi-calculator', { months: 12, price: 999, rate: 12 });
    expect(url).toBe('/tools/emi-calculator?months=12&price=999&rate=12');
    expect(parseCalculationShareParams('months=12&price=999&rate=12')).toEqual({
      months: '12',
      price: '999',
      rate: '12',
    });
  });

  it('returns null for an unknown tool or empty params', () => {
    expect(buildCalculationShareUrl('not-a-tool', { price: 1 })).toBeNull();
    expect(buildCalculationShareUrl('emi-calculator', {})).toBeNull();
  });

  it('accepts only the 12 pure-local calculator tools', () => {
    expect(isSavedCalculationTool('emi-calculator')).toBe(true);
    expect(isSavedCalculationTool('currency-converter')).toBe(true);
    expect(isSavedCalculationTool('price-alert-simulator')).toBe(false);
    expect(isSavedCalculationTool('search')).toBe(false);
  });
});

describe('validateSavedCalculationInput (Section 16, #36)', () => {
  it('accepts a tool + label + scalar params and trims the label', () => {
    const result = validateSavedCalculationInput({
      tool: 'emi-calculator',
      label: '  EMI $999  ',
      params: { price: 999, rate: 12, months: 12 },
    });
    expect(result).toEqual({
      ok: true,
      tool: 'emi-calculator',
      label: 'EMI $999',
      params: { price: 999, rate: 12, months: 12 },
    });
  });

  it('rejects a non-calculator tool, a blank label, and non-scalar params', () => {
    expect(
      validateSavedCalculationInput({ tool: 'search', label: 'x', params: { q: 'a' } }).ok
    ).toBe(false);
    expect(
      validateSavedCalculationInput({ tool: 'emi-calculator', label: ' ', params: { price: 1 } }).ok
    ).toBe(false);
    expect(
      validateSavedCalculationInput({
        tool: 'emi-calculator',
        label: 'x',
        params: { nested: { a: 1 } },
      }).ok
    ).toBe(false);
    expect(
      validateSavedCalculationInput({ tool: 'emi-calculator', label: 'x', params: {} }).ok
    ).toBe(false);
  });
});

// --- Fake saved_calculations client ----------------------------------------

const calcFakeDb = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  tableMissing: false,
  idCounter: 0,
}));

function makeCalcFakeClient() {
  function builder(_table: string) {
    const state: { op: 'select' | 'insert' | 'delete'; insertRow?: Record<string, unknown> } = {
      op: 'select',
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      insert: (row: Record<string, unknown>) => {
        state.op = 'insert';
        state.insertRow = row;
        return chain;
      },
      delete: () => {
        state.op = 'delete';
        return chain;
      },
      single: async () => {
        if (calcFakeDb.tableMissing) return { data: null, error: missingTableError };
        if (state.op !== 'insert' || !state.insertRow) {
          return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        }
        calcFakeDb.idCounter += 1;
        const row: Record<string, unknown> = {
          id: `c-new-${calcFakeDb.idCounter}`,
          user_id: state.insertRow.user_id,
          tool: state.insertRow.tool,
          label: state.insertRow.label,
          params: state.insertRow.params,
          share_token: 'token-abc',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        calcFakeDb.rows.push(row);
        return { data: row, error: null };
      },
      then: (resolve: (value: unknown) => void) => {
        if (calcFakeDb.tableMissing) {
          resolve({ data: null, error: missingTableError });
          return;
        }
        resolve({ data: calcFakeDb.rows, error: null });
      },
    };
    return chain;
  }
  return { from: (table: string) => builder(table) } as unknown as AnySupabaseClient;
}

describe('saved calculations service (Section 16, #36)', () => {
  beforeEach(() => {
    calcFakeDb.rows = [];
    calcFakeDb.tableMissing = false;
    calcFakeDb.idCounter = 0;
  });

  it('creates a row and builds its re-open share URL from the params', async () => {
    const client = makeCalcFakeClient();
    const result = await createSavedCalculation(client, 'user-1', {
      tool: 'emi-calculator',
      label: 'EMI $999',
      params: { price: 999, rate: 12, months: 12 },
    });
    expect('savedCalculation' in result).toBe(true);
    if ('savedCalculation' in result) {
      expect(result.savedCalculation.shareUrl).toBe(
        '/tools/emi-calculator?months=12&price=999&rate=12'
      );
      expect(result.savedCalculation.shareToken).toBe('token-abc');
    }
  });

  it('lists the caller\'s saved calculations (empty when the table is missing)', async () => {
    const client = makeCalcFakeClient();
    expect(await listSavedCalculations(client, 'user-1')).toEqual([]);
    calcFakeDb.tableMissing = true;
    expect(await listSavedCalculations(client, 'user-1')).toEqual([]);
  });

  it('fails closed with missing-table when migration 043 is unapplied', async () => {
    calcFakeDb.tableMissing = true;
    const client = makeCalcFakeClient();
    const result = await createSavedCalculation(client, 'user-1', {
      tool: 'emi-calculator',
      label: 'EMI $999',
      params: { price: 999 },
    });
    expect(result).toEqual({ error: 'missing-table' });
  });
});

// ---------------------------------------------------------------------------
// Route tests (#31, #32 PATCH, #38 GET) — mocked auth/admin + clients
// ---------------------------------------------------------------------------

const newsletterStub = vi.hoisted(() => ({
  result: { ok: true, sent: 2, failed: 0, total: 2, skippedUnsubscribed: 0 } as Record<
    string,
    unknown
  >,
}));

const viewsDb = vi.hoisted(() => ({
  viewRows: [] as Array<{ product_id: string; viewed_at: string }>,
  productRows: [] as Array<Record<string, unknown>>,
  merchantRows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/api/middleware', () => ({
  logApiRequest: () => undefined,
  rateLimitResponse: async () => null,
  getClientIp: () => '127.0.0.1',
  requireAuth: async () => ({ userId: 'user-1' }),
  requireAdmin: async () => ({ userId: 'admin-1' }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({}),
}));

vi.mock('@/services/newsletter-send', () => ({
  sendNewsletterToSubscribers: async () => newsletterStub.result,
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    function builder(table: string) {
      const state: {
        updatePatch?: Record<string, unknown>;
        eqFilters: Record<string, unknown>;
      } = { eqFilters: {} };
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: () => chain,
        update: (patch: Record<string, unknown>) => {
          state.updatePatch = patch;
          return chain;
        },
        delete: () => chain,
        eq: (col: string, value: unknown) => {
          state.eqFilters[col] = value;
          return chain;
        },
        order: () => chain,
        is: () => chain,
        neq: () => chain,
        in: () => chain,
        limit: () => chain,
        single: async () => {
          if (table === 'saved_searches') {
            const row = notifyFakeDb.rows.find(
              (r) => r.id === state.eqFilters.id && r.user_id === state.eqFilters.user_id
            );
            if (!row) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
            if (state.updatePatch) Object.assign(row, state.updatePatch);
            return { data: row, error: null };
          }
          return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        },
        then: (resolve: (value: unknown) => void) => {
          if (table === 'product_views') {
            resolve({ data: viewsDb.viewRows, error: null });
            return;
          }
          if (table === 'products') {
            resolve({ data: viewsDb.productRows, error: null });
            return;
          }
          if (table === 'merchant_products') {
            resolve({ data: viewsDb.merchantRows, error: null });
            return;
          }
          resolve({ data: notifyFakeDb.rows, error: null });
        },
      };
      return chain;
    }
    return { from: (table: string) => builder(table) };
  },
}));

function apiRequest(method: string, url: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe('POST /api/v1/admin/newsletter/send (Section 16, #31)', () => {
  it('sends via the newsletter service and returns the honest counts', async () => {
    newsletterStub.result = { ok: true, sent: 2, failed: 0, total: 2, skippedUnsubscribed: 0 };
    const { POST } = await import('@/app/api/v1/admin/newsletter/send/route');
    const res = await POST(apiRequest('POST', 'http://localhost/api/v1/admin/newsletter/send', { limit: 50 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sent).toBe(2);
    expect(json.data.ok).toBe(true);
  });

  it('fails closed 503 when email is not configured — nothing is claimed sent', async () => {
    newsletterStub.result = {
      ok: false,
      reason: 'email-not-configured',
      sent: 0,
      failed: 0,
      total: 0,
      skippedUnsubscribed: 0,
    };
    const { POST } = await import('@/app/api/v1/admin/newsletter/send/route');
    const res = await POST(apiRequest('POST', 'http://localhost/api/v1/admin/newsletter/send', {}));
    expect(res.status).toBe(503);
  });

  it('fails closed 503 when migration 036 is unapplied', async () => {
    newsletterStub.result = {
      ok: false,
      reason: 'table-missing',
      sent: 0,
      failed: 0,
      total: 0,
      skippedUnsubscribed: 0,
    };
    const { POST } = await import('@/app/api/v1/admin/newsletter/send/route');
    const res = await POST(apiRequest('POST', 'http://localhost/api/v1/admin/newsletter/send', {}));
    expect(res.status).toBe(503);
  });
});

describe('PATCH /api/v1/saved-searches (Section 16, #32)', () => {
  beforeEach(() => {
    notifyFakeDb.rows = [
      {
        id: 's-1',
        user_id: 'user-1',
        name: 'Laptops',
        query: 'q=laptop',
        notify_on_match: false,
        last_notified_at: null,
        created_at: '2026-11-01T09:00:00.000Z',
        updated_at: '2026-11-01T09:00:00.000Z',
      },
    ];
    notifyFakeDb.tableMissing = false;
  });

  it('turns match notifications on for the caller\'s own search', async () => {
    const { PATCH } = await import('@/app/api/v1/saved-searches/route');
    const res = await PATCH(
      apiRequest('PATCH', 'http://localhost/api/v1/saved-searches?id=s-1', {
        notifyOnMatch: true,
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.notifyOnMatch).toBe(true);
  });

  it('rejects a non-boolean notifyOnMatch', async () => {
    const { PATCH } = await import('@/app/api/v1/saved-searches/route');
    const res = await PATCH(
      apiRequest('PATCH', 'http://localhost/api/v1/saved-searches?id=s-1', {
        notifyOnMatch: 'yes',
      })
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/product-views (Section 16, #38)', () => {
  beforeEach(() => {
    viewsDb.viewRows = [
      { product_id: 'p-macbook', viewed_at: '2026-11-06T09:00:00.000Z' },
      { product_id: 'p-sony', viewed_at: '2026-11-05T09:00:00.000Z' },
      { product_id: 'p-macbook', viewed_at: '2026-11-04T09:00:00.000Z' },
    ];
    viewsDb.productRows = [
      { id: 'p-macbook', name: 'MacBook Air 13', slug: 'macbook-air-13', brand: 'Apple', category: 'laptop', image_url: null },
      { id: 'p-sony', name: 'Sony WH-1000XM5', slug: 'sony-wh-1000xm5', brand: 'Sony', category: 'headphones', image_url: null },
    ];
    viewsDb.merchantRows = [
      { product_id: 'p-macbook', merchant_id: 'm-amazon', price: 999, compare_at_price: 1099 },
      { product_id: 'p-sony', merchant_id: 'm-amazon', price: 349, compare_at_price: 399 },
    ];
  });

  it('returns the signed-in history deduped, most-recent-first, with prices', async () => {
    const { GET } = await import('@/app/api/v1/product-views/route');
    const res = await GET(apiRequest('GET', 'http://localhost/api/v1/product-views'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({
      id: 'p-macbook',
      slug: 'macbook-air-13',
      name: 'MacBook Air 13',
      price: 999,
      viewedAt: '2026-11-06T09:00:00.000Z',
    });
    expect(json.data[1]).toMatchObject({ id: 'p-sony', price: 349 });
  });

  it('returns an empty list when the user has no views', async () => {
    viewsDb.viewRows = [];
    const { GET } = await import('@/app/api/v1/product-views/route');
    const res = await GET(apiRequest('GET', 'http://localhost/api/v1/product-views'));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// File assertions — wiring that is only observable in source
// ---------------------------------------------------------------------------

describe('Section 16, #30–#38 file wiring', () => {
  it('#30: the stale "no compare-at price" comment is gone from the search page', () => {
    const page = readRepo('app/search/page.tsx');
    expect(page).not.toContain('neither list carries an original');
    expect(page).toContain('discount-desc');
    expect(page).toContain('Biggest Discount');
  });

  it('#32: migration 042 adds the notify columns and is flagged DO NOT APPLY YET', () => {
    const migration = readRepo(
      'supabase/migrations/20261112120000_042_saved_search_match_notifications.sql'
    );
    expect(migration).toContain('DO NOT APPLY YET');
    expect(migration).toContain('notify_on_match');
    expect(migration).toContain('last_notified_at');
  });

  it('#32: the refresh chain runs the saved-search step', () => {
    const refresh = readRepo('app/api/v1/prices/refresh/route.ts');
    expect(refresh).toContain('notifySavedSearchMatches');
    expect(refresh).toContain('savedSearches');
  });

  it('#33: the simulator page mounts the one-click real-alert button', () => {
    const page = readRepo('app/tools/price-alert-simulator/page.tsx');
    expect(page).toContain('SimulatorToAlertButton');
    expect(page).toContain('creates NO real price alert');
    const button = readRepo('components/tools/simulator-to-alert-button.tsx');
    expect(button).toContain("fetch('/api/v1/alerts'");
    expect(button).toContain("alertType: 'price_drop'");
  });

  it('#34: the admin affiliate-clicks report already exists (API + admin tab, clicks only)', () => {
    const route = readRepo('app/api/v1/admin/affiliate-clicks/route.ts');
    expect(route).toContain('getAffiliateClickAnalytics');
    expect(route).toContain('requireAdmin');
    const admin = readRepo('app/admin/page.tsx');
    expect(admin).toContain('AffiliateClicksSection');
    expect(admin).toContain('byRetailer');
    // Clicks only — no earnings/revenue is ever invented here.
    expect(route).not.toMatch(/revenue|earnings/i);
  });

  it('#35: push opt-in is surfaced after alert creation (dialog + simulator)', () => {
    const dialog = readRepo('components/products/price-alert-dialog.tsx');
    expect(dialog).toContain('PushOptInPrompt');
    const simulatorButton = readRepo('components/tools/simulator-to-alert-button.tsx');
    expect(simulatorButton).toContain('PushOptInPrompt');
    const productPage = readRepo('components/products/product-detail-client.tsx');
    expect(productPage).toContain('PushOptInPrompt');
  });

  it('#36: migration 043 adds saved_calculations and is flagged DO NOT APPLY YET', () => {
    const migration = readRepo(
      'supabase/migrations/20261112121000_043_saved_calculations.sql'
    );
    expect(migration).toContain('DO NOT APPLY YET');
    expect(migration).toContain('saved_calculations');
    expect(migration).toContain('share_token');
  });

  it('#36: the save button is wired into the EMI, landed-cost and currency tools', () => {
    for (const tool of ['emi-calculator', 'landed-cost', 'currency-converter']) {
      const page = readRepo(`app/tools/${tool}/page.tsx`);
      expect(page).toContain('SaveCalculationButton');
    }
  });

  it('#38: the strip merges the account history and the GET route exists', () => {
    const strip = readRepo('components/home/recently-viewed-strip.tsx');
    expect(strip).toContain("fetch('/api/v1/product-views')");
    expect(strip).toContain('Synced to your account');
    const route = readRepo('app/api/v1/product-views/route.ts');
    expect(route).toContain('export async function GET');
    expect(route).toContain('export async function DELETE');
  });
});
