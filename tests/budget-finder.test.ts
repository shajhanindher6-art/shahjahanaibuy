import { describe, expect, it } from 'vitest';
import {
  parseBudgetFinderParams,
  rankGuidedPicks,
  type GuidedCandidate,
} from '@/services/guided-finder';

function candidate(partial: Partial<GuidedCandidate> & { slug: string }): GuidedCandidate {
  return {
    id: partial.slug,
    name: 'Product',
    brand: null,
    category: 'Laptops',
    description: null,
    bestPriceUsd: 500,
    compareAtUsd: null,
    merchantName: 'Amazon',
    dealScore: null,
    ...partial,
  };
}

describe('parseBudgetFinderParams', () => {
  it('parses a normal ?category=&budget= pair', () => {
    expect(parseBudgetFinderParams({ category: 'laptop', budget: '1000' })).toEqual({
      category: 'laptop',
      budgetUsd: 1000,
      budgetError: null,
    });
  });

  it('returns nulls when nothing is given (form state, not an error)', () => {
    expect(parseBudgetFinderParams({})).toEqual({
      category: null,
      budgetUsd: null,
      budgetError: null,
    });
  });

  it('accepts a category without a budget and vice versa', () => {
    expect(parseBudgetFinderParams({ category: 'Headphones' })).toEqual({
      category: 'Headphones',
      budgetUsd: null,
      budgetError: null,
    });
    expect(parseBudgetFinderParams({ budget: '250' })).toEqual({
      category: null,
      budgetUsd: 250,
      budgetError: null,
    });
  });

  it('rejects non-numeric, zero, and negative budgets instead of guessing', () => {
    for (const bad of ['free', '0', '-100', 'NaN', '']) {
      // '' is "no budget given", not an error — covered separately.
      if (bad === '') continue;
      const result = parseBudgetFinderParams({ budget: bad });
      expect(result.budgetUsd).toBeNull();
      expect(result.budgetError).toMatch(/not a valid budget/);
    }
    expect(parseBudgetFinderParams({ budget: '' }).budgetError).toBeNull();
  });

  it('trims whitespace and takes the first value of repeated params', () => {
    expect(
      parseBudgetFinderParams({ category: ['  Laptops  ', 'Phones'], budget: [' 500 '] })
    ).toEqual({ category: 'Laptops', budgetUsd: 500, budgetError: null });
  });
});

describe('Budget Finder ranking (deal sort, same shared helper)', () => {
  it('ranks by biggest saving first, then Deal Score, then lowest price', () => {
    const picks = rankGuidedPicks(
      [
        candidate({ slug: 'no-saving', bestPriceUsd: 200, compareAtUsd: null, dealScore: 99 }),
        candidate({ slug: 'small-saving', bestPriceUsd: 400, compareAtUsd: 500, dealScore: 50 }),
        candidate({ slug: 'big-saving-low-score', bestPriceUsd: 600, compareAtUsd: 1000, dealScore: 40 }),
        candidate({ slug: 'big-saving-high-score', bestPriceUsd: 600, compareAtUsd: 1000, dealScore: 90 }),
        candidate({ slug: 'big-saving-cheap', bestPriceUsd: 500, compareAtUsd: 1000, dealScore: 90 }),
      ],
      { budgetUsd: 1000, sortBy: 'deal' }
    );
    // 50% off beats 40% off beats 20% off beats no saving; among
    // the 40%-off pair the higher Deal Score wins.
    expect(picks.map((p) => p.slug)).toEqual([
      'big-saving-cheap',
      'big-saving-high-score',
      'big-saving-low-score',
      'small-saving',
      'no-saving',
    ]);
  });

  it('never lists an over-budget product, even a great deal', () => {
    const picks = rankGuidedPicks(
      [
        candidate({ slug: 'deal-over-budget', bestPriceUsd: 1200, compareAtUsd: 2000, dealScore: 99 }),
        candidate({ slug: 'plain-in-budget', bestPriceUsd: 800, compareAtUsd: null }),
      ],
      { budgetUsd: 1000, sortBy: 'deal' }
    );
    expect(picks.map((p) => p.slug)).toEqual(['plain-in-budget']);
  });

  it('returns an honest empty list when nothing is priced in range', () => {
    const products = [
      candidate({ slug: 'expensive', bestPriceUsd: 2000 }),
      candidate({ slug: 'unpriced', bestPriceUsd: null }),
    ];
    expect(rankGuidedPicks(products, { budgetUsd: 100, sortBy: 'deal' })).toEqual([]);
  });

  it('combines category + budget the way the page query does', () => {
    const picks = rankGuidedPicks(
      [
        candidate({ slug: 'laptop-a', category: 'Laptops', bestPriceUsd: 900, compareAtUsd: 1200 }),
        candidate({ slug: 'phone-a', category: 'Phones', bestPriceUsd: 400, compareAtUsd: 800 }),
      ],
      { category: 'laptop', budgetUsd: 1000, sortBy: 'deal' }
    );
    expect(picks.map((p) => p.slug)).toEqual(['laptop-a']);
    expect(picks[0].savingPct).toBe(25);
    expect(picks[0].verdict).toBe('Great deal');
  });
});
