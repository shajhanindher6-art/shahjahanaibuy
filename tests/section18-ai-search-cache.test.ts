/**
 * Section 18, Phase 2 — SerpAPI `fromCache` labelling (audit §1
 * #24, §12 item 34).
 *
 * `searchWebProducts` returned `fromCache` but the route discarded
 * it, and the page heading said "Live web results" for up-to-7-day-
 * old cached prices. Now the outcome carries `fromCache` +
 * `fetchedAt` (the cache entry's timestamp, never invented), the
 * route passes both through in meta, and the page labels cached
 * results with their age.
 *
 * The fake client is minimal: the external_search_cache table
 * (read + upsert) and a missing-table error when unseeded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from '@/lib/config/env';
import { searchWebProducts } from '@/services/external-search';

type Row = Record<string, unknown>;

const fakeDb: Record<string, Row[]> = {};
let fetchCalls = 0;

function seedCache(rows: Row[]): void {
  fakeDb['external_search_cache'] = rows.map((r) => ({ ...r }));
}

function fakeClient() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          gt: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => {
                  const rows = fakeDb[table];
                  if (!rows) {
                    return { data: null, error: { code: 'PGRST205', message: 'table missing' } };
                  }
                  return { data: rows[0] ?? null, error: null };
                },
              }),
            }),
          }),
        }),
      }),
      upsert: async (row: Row) => {
        fakeDb[table] = [row];
        return { data: [row], error: null };
      },
    }),
  } as unknown as Parameters<typeof searchWebProducts>[0];
}

function serpApiResponse() {
  return {
    shopping_results: [
      {
        title: 'Test Phone',
        product_link: 'https://example.com/phone',
        extracted_price: 299,
        source: 'Test Store',
        thumbnail: 'https://example.com/thumb.jpg',
        rating: 4.5,
        reviews: 12,
      },
    ],
  };
}

// env.serpApiKey is a read-only property in the env type —
// mutate it through a cast (the object itself is mutable).
function setSerpApiKey(value: string | undefined): void {
  (env as { serpApiKey?: string }).serpApiKey = value;
}

function repoFile(...parts: string[]): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...parts),
    'utf8'
  );
}

beforeEach(() => {
  fetchCalls = 0;
  for (const k of Object.keys(fakeDb)) delete fakeDb[k];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      fetchCalls++;
      return { ok: true, json: async () => serpApiResponse() };
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchWebProducts fromCache + fetchedAt (item 34)', () => {
  it('live fetch returns fromCache:false with the fetch time stamped', async () => {
    setSerpApiKey('test-serpapi-key');
    const out = await searchWebProducts(fakeClient(), 'test phone q1', 10);
    expect(out.disabled).toBe(false);
    expect(out.fromCache).toBe(false);
    expect(out.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].fetched_at).toBe(out.fetchedAt);
    expect(fetchCalls).toBe(1);
  });

  it('second call for the same query is a memory-cache hit with the same timestamp', async () => {
    setSerpApiKey('test-serpapi-key');
    const first = await searchWebProducts(fakeClient(), 'test phone q2', 10);
    const second = await searchWebProducts(fakeClient(), 'test phone q2', 10);
    expect(second.fromCache).toBe(true);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.results[0].fetched_at).toBe(first.fetchedAt);
    expect(fetchCalls).toBe(1); // no second SerpAPI call
  });

  it('DB cache hit returns fromCache:true with the stored timestamp, no fetch', async () => {
    setSerpApiKey('test-serpapi-key');
    seedCache([
      {
        query_key: 'db phone|10|any',
        results: [
          {
            id: 'web-abc-1', title: 'Cached Phone', price: 199, currency: 'USD',
            source: 'Cached Store', link: 'https://example.com/cached',
            thumbnail: null, rating: null, reviews: null,
            fetched_at: '2026-11-05T10:00:00Z',
          },
        ],
        fetched_at: '2026-11-05T10:00:00Z',
        expires_at: '2026-11-19T10:00:00Z',
      },
    ]);
    const out = await searchWebProducts(fakeClient(), 'db phone', 10);
    expect(out.fromCache).toBe(true);
    expect(out.fetchedAt).toBe('2026-11-05T10:00:00Z');
    expect(out.results[0].fetched_at).toBe('2026-11-05T10:00:00Z');
    expect(fetchCalls).toBe(0);
  });

  it('DB row without fetched_at reports fromCache:true with a null age (never invented)', async () => {
    setSerpApiKey('test-serpapi-key');
    seedCache([
      {
        query_key: 'old phone|10|any',
        results: [
          {
            id: 'web-old-1', title: 'Old Phone', price: 99, currency: 'USD',
            source: 'Old Store', link: 'https://example.com/old',
            thumbnail: null, rating: null, reviews: null,
          },
        ],
        fetched_at: null,
        expires_at: '2026-11-19T10:00:00Z',
      },
    ]);
    const out = await searchWebProducts(fakeClient(), 'old phone', 10);
    expect(out.fromCache).toBe(true);
    expect(out.fetchedAt).toBeNull();
    expect(out.results[0].fetched_at).toBeNull();
  });

  it('disabled when no key is configured, with a null age', async () => {
    setSerpApiKey(undefined);
    const out = await searchWebProducts(fakeClient(), 'no key phone', 10);
    expect(out.disabled).toBe(true);
    expect(out.fromCache).toBe(false);
    expect(out.fetchedAt).toBeNull();
    expect(fetchCalls).toBe(0);
  });
});

describe('fromCache passthrough to the page (item 34)', () => {
  it('the ai-search route passes webFromCache + webFetchedAt in meta', () => {
    const src = repoFile('app', 'api', 'v1', 'ai-search', 'route.ts');
    expect(src).toContain('webFromCache = web.fromCache');
    expect(src).toContain('webFetchedAt = web.fetchedAt');
    expect(src).toContain('webFromCache,');
    expect(src).toContain('webFetchedAt,');
  });

  it('the search page never says "Live" for cached results', () => {
    const src = repoFile('app', 'search', 'page.tsx');
    expect(src).toContain("webFromCache ? 'Web results (cached)'");
    expect(src).toContain('setWebFromCache(data.meta?.webFromCache === true)');
    expect(src).toContain('setWebFetchedAt');
    expect(src).toContain('prices fetched');
    // The old heading is gone — no bare liveWeb-only heading.
    expect(src).not.toContain("{liveWeb ? 'Live web results' : 'Web results'}");
  });
});
