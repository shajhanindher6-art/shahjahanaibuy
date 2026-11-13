/**
 * Section 19, Phase 9 (§12 #79) — direct tests for the AI review
 * summary service (services/review-summary.ts).
 *
 * This service had ZERO direct tests: no test file imported it.
 * These tests pin its core contract:
 *   - 0 reviews → null (the honest empty state, never an invented
 *     summary, theme, verdict, or quote).
 *   - Every theme / positive / concern / quote comes from a REAL
 *     review row: a theme is only mentioned when at least one
 *     review mentions it, counts match the rows, and the most
 *     helpful entry quotes the real review text.
 *   - The verified split is computed from verified rows only.
 *   - A DB error → null, never a throw and never a fabricated
 *     summary.
 *
 * The Supabase client is a small chainable stub (thenable builder
 * with eq / in / is / order / limit / maybeSingle / insert).
 * Product ids are unique per test because getReviewAISummary
 * caches through swrGet (in-memory, keyed by product id).
 */

import { describe, expect, it } from 'vitest';
import { getReviewAISummary } from '@/services/review-summary';
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
      insert() {
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

/** A client whose reviews read fails — the service must return null. */
function errorStub(): AnySupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () =>
      Promise.resolve({ data: null, error: { message: 'database down' } }),
    insert: () => Promise.resolve({ data: null, error: { message: 'database down' } }),
    then(
      onFulfilled?: (value: { data: null; error: { message: string } }) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) {
      return Promise.resolve({ data: null, error: { message: 'database down' } }).then(
        onFulfilled,
        onRejected
      );
    },
  };
  return { from: () => builder } as unknown as AnySupabaseClient;
}

function reviewRow(overrides: Partial<Row> = {}): Row {
  return {
    rating: 5,
    title: null,
    content: null,
    author_name: 'Buyer',
    verified_purchase: false,
    helpful_count: 0,
    source_url: null,
    review_source_id: null,
    deleted_at: null,
    ...overrides,
  };
}

function stub(productId: string, reviews: Row[], extra: Record<string, Row[]> = {}): AnySupabaseClient {
  return createStubSupabase({
    reviews: reviews.map((r) => ({ ...r, product_id: productId })),
    review_sources: [],
    ...extra,
  });
}

describe('getReviewAISummary — no reviews, no summary (#79)', () => {
  it('0 reviews → null: no invented summary, theme, verdict, or quote', async () => {
    const result = await getReviewAISummary(stub('p19-rs-empty', []), 'p19-rs-empty');
    expect(result).toBeNull();
  });

  it('a DB error → null, never a throw and never a fabricated summary', async () => {
    const result = await getReviewAISummary(errorStub(), 'p19-rs-dberror');
    expect(result).toBeNull();
  });
});

describe('getReviewAISummary — themes come only from real reviews (#79)', () => {
  it('mentions only themes real reviews mention, with real counts', async () => {
    const result = await getReviewAISummary(
      stub('p19-rs-themes', [
        reviewRow({ rating: 5, content: 'Battery life is amazing, lasts all day', helpful_count: 2 }),
        reviewRow({ rating: 5, content: 'Great battery and fast charging', helpful_count: 1 }),
        reviewRow({ rating: 2, content: 'The screen is dim and terrible', helpful_count: 0 }),
      ]),
      'p19-rs-themes'
    );
    expect(result).not.toBeNull();
    const themeNames = result!.themes.map((t) => t.theme);
    expect(themeNames).toContain('Battery life');
    expect(themeNames).toContain('Screen / display');
    // Camera / Build quality / Sound / Portability / Value / Ease of
    // use / Software were never mentioned — they must not appear.
    expect(themeNames).not.toContain('Camera');
    expect(themeNames).not.toContain('Build quality');
    expect(themeNames).not.toContain('Sound / audio');
    expect(themeNames).not.toContain('Portability');
    expect(themeNames).not.toContain('Value for money');
    expect(themeNames).not.toContain('Ease of use');
    expect(themeNames).not.toContain('Software');

    const battery = result!.themes.find((t) => t.theme === 'Battery life')!;
    expect(battery.positiveCount).toBe(2);
    expect(battery.negativeCount).toBe(0);
    const screen = result!.themes.find((t) => t.theme === 'Screen / display')!;
    expect(screen.positiveCount).toBe(0);
    expect(screen.negativeCount).toBe(1);

    expect(result!.positives).toContain('Buyers praise its battery life (2 mentions)');
    expect(result!.concerns).toContain('Some buyers raise concerns about screen / display (1 mention)');
    expect(result!.summary).toContain('Based on 3 reviews');
    expect(result!.summary).toContain('average 4.0 out of 5');
    expect(result!.verdict).toBe('Recommended');
  });

  it('3-star reviews are neutral: they never create a theme', async () => {
    const result = await getReviewAISummary(
      stub('p19-rs-neutral', [
        reviewRow({ rating: 3, content: 'Battery is okay, nothing special' }),
      ]),
      'p19-rs-neutral'
    );
    expect(result).not.toBeNull();
    expect(result!.themes).toEqual([]);
    expect(result!.positives).toEqual([]);
    expect(result!.concerns).toEqual([]);
    expect(result!.verdict).toBe('Mixed Reviews');
  });

  it('low average with no matching theme → a derived concern, not an invented one', async () => {
    const result = await getReviewAISummary(
      stub('p19-rs-low', [
        reviewRow({ rating: 2, content: 'Terrible product, do not buy' }),
        reviewRow({ rating: 2, content: 'Stopped working after a week' }),
        reviewRow({ rating: 1, content: 'Worst purchase ever' }),
      ]),
      'p19-rs-low'
    );
    expect(result).not.toBeNull();
    expect(result!.averageRating).toBeCloseTo(1.67, 1);
    expect(result!.verdict).toBe('Not Recommended');
    expect(result!.concerns).toContain('Overall rating is below average');
    expect(result!.themes).toEqual([]);
  });
});

describe('getReviewAISummary — verified split and most helpful (#79)', () => {
  it('verified average and count come from verified rows only', async () => {
    const result = await getReviewAISummary(
      stub('p19-rs-verified', [
        reviewRow({ rating: 5, verified_purchase: true, content: 'Excellent battery' }),
        reviewRow({ rating: 1, verified_purchase: false, content: 'Awful screen' }),
      ]),
      'p19-rs-verified'
    );
    expect(result).not.toBeNull();
    expect(result!.averageRating).toBe(3);
    expect(result!.verifiedAverageRating).toBe(5);
    expect(result!.verifiedCount).toBe(1);
    expect(result!.summary).toContain('Verified buyers rate it 5.0 on average (1 verified review)');
  });

  it('no verified reviews → verified average is null, never invented', async () => {
    const result = await getReviewAISummary(
      stub('p19-rs-unverified', [
        reviewRow({ rating: 4, verified_purchase: false, content: 'Good battery life' }),
      ]),
      'p19-rs-unverified'
    );
    expect(result).not.toBeNull();
    expect(result!.verifiedAverageRating).toBeNull();
    expect(result!.verifiedCount).toBe(0);
    expect(result!.summary).not.toContain('Verified buyers');
  });

  it('most helpful quotes the real highest-helpful review, never an invented quote', async () => {
    const result = await getReviewAISummary(
      stub('p19-rs-helpful', [
        reviewRow({
          rating: 5,
          title: 'Great battery',
          content: 'Battery lasts two full days of heavy use.',
          helpful_count: 3,
        }),
        reviewRow({
          rating: 5,
          title: 'Loved it',
          content: 'Best phone I have owned, the camera is superb.',
          helpful_count: 10,
        }),
      ]),
      'p19-rs-helpful'
    );
    expect(result).not.toBeNull();
    expect(result!.mostHelpful).not.toBeNull();
    expect(result!.mostHelpful!.content).toBe('Best phone I have owned, the camera is superb.');
    expect(result!.mostHelpful!.title).toBe('Loved it');
    expect(result!.mostHelpful!.helpfulCount).toBe(10);
  });

  it('reviews with no title and no content → most helpful is null', async () => {
    const result = await getReviewAISummary(
      stub('p19-rs-notext', [reviewRow({ rating: 4, helpful_count: 5 })]),
      'p19-rs-notext'
    );
    expect(result).not.toBeNull();
    expect(result!.mostHelpful).toBeNull();
  });
});

describe('getReviewAISummary — source links are real or absent (#79)', () => {
  it('carries the real source URL + name, and no invented source links', async () => {
    const result = await getReviewAISummary(
      stub(
        'p19-rs-sources',
        [
          reviewRow({
            rating: 5,
            content: 'Great battery life',
            source_url: 'https://www.amazon.com/review/xyz',
            review_source_id: 'src-amazon',
          }),
          reviewRow({
            rating: 4,
            content: 'Good screen',
            source_url: 'https://example.com/r/2',
            review_source_id: null,
          }),
        ],
        {
          review_sources: [{ id: 'src-amazon', name: 'Amazon' }],
        }
      ),
      'p19-rs-sources'
    );
    expect(result).not.toBeNull();
    expect(result!.sentiment).not.toBeNull();
    expect(result!.sentiment!.sources).toEqual([
      { name: 'Amazon', url: 'https://www.amazon.com/review/xyz' },
      { name: 'example.com', url: 'https://example.com/r/2' },
    ]);
  });

  it('no source_url anywhere → no source links at all', async () => {
    const result = await getReviewAISummary(
      stub('p19-rs-nosources', [
        reviewRow({ rating: 5, content: 'Great battery life' }),
      ]),
      'p19-rs-nosources'
    );
    expect(result).not.toBeNull();
    expect(result!.sentiment).not.toBeNull();
    expect(result!.sentiment!.sources).toEqual([]);
  });
});
