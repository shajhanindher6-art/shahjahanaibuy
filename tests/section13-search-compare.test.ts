import { describe, expect, it } from 'vitest';
import {
  computeTrendStats,
  filterPointsByRange,
  type TrendPoint,
} from '@/lib/price-trend';
import {
  computeDealScoreFromPrediction,
  type DealScorePrediction,
} from '@/lib/deal-score';
import { deriveTaxonomySlugs, slugify } from '@/lib/brand-category-seo';

// Section 13, Chunk A — search / deals / compare depth. These tests
// cover the pure logic the new UI relies on, with the live catalog's
// real data shape (10 products; 4 price-history points per product,
// Amazon only, 30 days max, last two points identical). The UI
// wiring itself (URL state, pagination slicing, filter dropdowns,
// merchant grid, URL sync) is client/server rendering covered by
// `tsc --noEmit` and the build; the rules below are what that
// wiring must not get wrong.

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 9, 1);

function day(n: number): string {
  return new Date(BASE + n * DAY_MS).toISOString();
}

function point(price: number, dayOffset: number): TrendPoint {
  return { price, recordedAt: day(dayOffset) };
}

describe('30-day change row (compare, item 9)', () => {
  // Live-data shape: 4 points over 30 days, last two identical.
  const history = [
    point(999, 0),
    point(949, 10),
    point(899, 20),
    point(899, 30),
  ];
  const nowMs = BASE + 30 * DAY_MS;

  it('keeps all 4 points inside the 30-day window', () => {
    expect(filterPointsByRange(history, 30, nowMs)).toHaveLength(4);
  });

  it('computes the change from the first point, not the last two', () => {
    // The last two points are identical (899 → 899), so a naive
    // "last minus previous" would report 0%. The row must report
    // the real 30-day move: (899 − 999) / 999 = −10.01%.
    const stats = computeTrendStats(filterPointsByRange(history, 30, nowMs));
    expect(stats).not.toBeNull();
    expect(stats?.change).toBe(-100);
    expect(stats?.changePercent).toBeCloseTo(-10.01, 2);
    expect(stats?.pointCount).toBe(4);
  });

  it('excludes points older than 30 days', () => {
    const withOld = [point(1099, -40), ...history];
    const stats = computeTrendStats(filterPointsByRange(withOld, 30, nowMs));
    expect(stats?.pointCount).toBe(4);
    expect(stats?.changePercent).toBeCloseTo(-10.01, 2);
  });

  it('reports a rise as a positive change', () => {
    const rising = [point(899, 0), point(949, 15), point(999, 30)];
    const stats = computeTrendStats(filterPointsByRange(rising, 30, nowMs));
    expect(stats?.changePercent).toBeCloseTo(11.12, 2);
  });

  it('returns null with no points — the cell says "No price history"', () => {
    expect(computeTrendStats(filterPointsByRange([], 30, nowMs))).toBeNull();
  });

  it('a single point carries no measurable change (pointCount 1)', () => {
    // computeTrendStats returns stats for one point (change 0);
    // the cell only renders a % when pointCount >= 2, so a lone
    // recorded price never reads as a flat "0.0% in 30 days".
    const stats = computeTrendStats(filterPointsByRange([point(899, 30)], 30, nowMs));
    expect(stats?.pointCount).toBe(1);
    expect(stats?.changePercent).toBe(0);
  });
});

describe('Deal Score sort (search, item 2)', () => {
  // score = 100 − prob×0.4 + (lowest/current)×30 + conf×0.3,
  // rounded, clamped 0–100 (lib/deal-score.ts).
  const high: DealScorePrediction = {
    discountProbability: 90,
    currentPrice: 1000,
    lowestPrice: 500,
    confidenceScore: 10,
  }; // 100 − 36 + 15 + 3 = 82
  const low: DealScorePrediction = {
    discountProbability: 95,
    currentPrice: 1000,
    lowestPrice: 400,
    confidenceScore: 10,
  }; // 100 − 38 + 12 + 3 = 77

  it('scores the two predictions distinctly', () => {
    expect(computeDealScoreFromPrediction(high)).toBe(82);
    expect(computeDealScoreFromPrediction(low)).toBe(77);
  });

  it('orders higher scores first, unscored (null) last', () => {
    const scored = [low, high, null].map((p) => ({
      prediction: p,
      score: computeDealScoreFromPrediction(p),
    }));
    const sorted = [...scored].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    expect(sorted.map((s) => s.score)).toEqual([82, 77, null]);
  });

  it('returns null for a missing prediction — never a synthesized score', () => {
    expect(computeDealScoreFromPrediction(null)).toBeNull();
    expect(computeDealScoreFromPrediction(undefined)).toBeNull();
  });

  it('clamps the score to 0–100', () => {
    expect(
      computeDealScoreFromPrediction({
        discountProbability: 0,
        currentPrice: 999,
        lowestPrice: 999,
        confidenceScore: 100,
      })
    ).toBe(100);
  });
});

describe('taxonomy counts + category links (items 11–13)', () => {
  it('derives one slug per distinct brand, collapsing case/space duplicates', () => {
    const slugs = deriveTaxonomySlugs(['Apple', 'Apple', 'Samsung', null, '', 'apple ']);
    expect(slugs).toEqual([
      { name: 'Apple', slug: 'apple' },
      { name: 'Samsung', slug: 'samsung' },
    ]);
  });

  it('counts products per slug from the same rows the list is built from', () => {
    // The index pages tally the same product rows by slug, so the
    // count next to each brand/category can never disagree with
    // the list itself — and the counts sum to the valid rows.
    const rows: Array<string | null> = ['Apple', 'Apple', 'Samsung', null, '', 'apple '];
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row) continue;
      const slug = slugify(row);
      if (!slug) continue;
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    const slugs = deriveTaxonomySlugs(rows);
    expect(slugs.map((s) => ({ ...s, count: counts.get(s.slug) ?? 0 }))).toEqual([
      { name: 'Apple', slug: 'apple', count: 3 },
      { name: 'Samsung', slug: 'samsung', count: 1 },
    ]);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('slugifies category names for the "Compare all X" link', () => {
    expect(slugify('Laptops')).toBe('laptops');
    expect(slugify('Home & Garden')).toBe('home-garden');
  });
});
