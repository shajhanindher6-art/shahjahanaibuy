/**
 * Typo-tolerant search tests (Section 15, B10).
 *
 * The Levenshtein did-you-mean existed before, but only on the
 * page and only for zero results — the search itself never
 * retried, so a typo'd query ("macbok") returned nothing even
 * though the catalog holds the product. Now aiSearch retries once
 * with the corrected tokens (fuzzy fallback) and also reports a
 * correction when the search returned FEW results
 * (< FEW_SEARCH_RESULTS). Trigram indexing was rejected as
 * overkill for a 10-product catalog — this is Levenshtein over
 * the catalog's own words, nothing more.
 *
 * Tests run aiSearch against a mocked Supabase client whose
 * chainable query builder simulates PostgREST ilike matching
 * (the `%token%` fragments of the .or() clause are matched
 * substring-wise against name/description/brand/category); no
 * DB, no network. The enrichment queries (prices, stores,
 * ratings) return empty, so prices are null and ratings are
 * null — the assertions here are about matching + didYouMean,
 * not prices.
 */
import { describe, expect, it } from 'vitest';
import { aiSearch, suggestFuzzyCorrection, parseSearchIntent } from '@/services/ai-search';
import { FEW_SEARCH_RESULTS } from '@/lib/search-suggestions';
import type { AnySupabaseClient } from '@/lib/supabase/types';

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

const CATALOG: CatalogRow[] = [
  productRow('p-macbook', 'MacBook Air 13', 'macbook-air-13', 'Apple', 'laptop', 'Lightweight laptop with M2 chip'),
  productRow('p-galaxy', 'Samsung Galaxy S24', 'samsung-galaxy-s24', 'Samsung', 'phone', 'Android smartphone'),
  productRow('p-sony', 'Sony WH-1000XM5', 'sony-wh-1000xm5', 'Sony', 'headphones', 'Noise cancelling headphones'),
];

function makeSearchClient(catalog: CatalogRow[]) {
  function builder(table: string) {
    const b: Record<string, unknown> = {
      _cols: '',
      _or: '',
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
        b._or = clause;
        return b;
      },
      ilike: (_col: string, pattern: string) => {
        b._ilike = pattern;
        return b;
      },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => void) => {
        if (table !== 'products') {
          resolve({ data: [], error: null });
          return;
        }
        // The fuzzy-correction catalog fetch selects only
        // name/brand/category: it reads the whole catalog, it
        // does not filter by the query tokens.
        if (b._cols === 'name, brand, category') {
          resolve({ data: catalog, error: null });
          return;
        }
        let rows = catalog.filter((r) => r.slug !== 'sample-laptop');
        const orClause = b._or as string;
        if (orClause) {
          const tokens = [...orClause.matchAll(/%([^%]+)%/g)].map((m) => m[1].toLowerCase());
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

describe('aiSearch fuzzy fallback (Section 15, B10)', () => {
  it('retries a zero-result typo and returns the corrected product', async () => {
    const client = makeSearchClient(CATALOG);
    const result = await aiSearch(client, { query: 'macbok' });
    expect(result.total).toBe(1);
    expect(result.results[0].product.slug).toBe('macbook-air-13');
    expect(result.didYouMean).toBe('macbook');
    expect(result.fuzzyCorrected).toBe(true);
  });

  it('returns no correction when the retry also finds nothing', async () => {
    const client = makeSearchClient(CATALOG);
    const result = await aiSearch(client, { query: 'zzzqqq' });
    expect(result.total).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(result.didYouMean).toBeNull();
    expect(result.fuzzyCorrected).toBe(false);
  });

  it('reports a correction for FEW results without re-running the search', async () => {
    // "samsng galaxy": the "galaxy" token matches the Galaxy
    // phone (1 result < FEW_SEARCH_RESULTS), and "samsng" is a
    // typo of "samsung" — the visitor should be told, not left
    // thinking the catalog has one Galaxy and nothing else.
    expect(FEW_SEARCH_RESULTS).toBe(3);
    const client = makeSearchClient(CATALOG);
    const result = await aiSearch(client, { query: 'samsng galaxy' });
    expect(result.total).toBe(1);
    expect(result.results[0].product.slug).toBe('samsung-galaxy-s24');
    expect(result.didYouMean).toBe('samsung galaxy');
    // The results are the TYPED query's — no silent re-run.
    expect(result.fuzzyCorrected).toBe(false);
  });

  it('reports no correction for an exact query with few results', async () => {
    const client = makeSearchClient(CATALOG);
    const result = await aiSearch(client, { query: 'macbook air 13' });
    expect(result.total).toBe(1);
    expect(result.didYouMean).toBeNull();
    expect(result.fuzzyCorrected).toBe(false);
  });

  it('reports no correction when the catalog is empty', async () => {
    const client = makeSearchClient([]);
    const result = await aiSearch(client, { query: 'macbok' });
    expect(result.total).toBe(0);
    expect(result.didYouMean).toBeNull();
  });
});

describe('suggestFuzzyCorrection (Section 15, B10)', () => {
  it('corrects a typo against the catalog words', async () => {
    const client = makeSearchClient(CATALOG);
    expect(await suggestFuzzyCorrection(client, 'macbok', parseSearchIntent('macbok'))).toBe('macbook');
    expect(await suggestFuzzyCorrection(client, 'samsng galaxy', parseSearchIntent('samsng galaxy'))).toBe(
      'samsung galaxy'
    );
  });

  it('returns null when nothing needs correcting', async () => {
    const client = makeSearchClient(CATALOG);
    expect(
      await suggestFuzzyCorrection(client, 'macbook air 13', parseSearchIntent('macbook air 13'))
    ).toBeNull();
  });

  it('returns null for an empty catalog', async () => {
    const client = makeSearchClient([]);
    expect(await suggestFuzzyCorrection(client, 'macbok', parseSearchIntent('macbok'))).toBeNull();
  });
});
