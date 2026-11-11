import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  encodeQuizAnswers,
  decodeQuizAnswers,
  answersToFinderInput,
  parseBudgetFinderParams,
  rankGuidedPicks,
  verdictForPick,
  type GuidedAnswers,
  type GuidedCandidate,
} from '@/services/guided-finder';
import { getStoresSplit, buildStoreSearchUrl } from '@/lib/stores';
import {
  getRecentlyViewed,
  recordRecentlyViewed,
  clearRecentlyViewed,
} from '@/lib/recently-viewed';

// Section 11 — cross-surface tests for the new tools. Each surface
// also has its own focused test file (guided-finder, budget-finder,
// recently-viewed, store-split); this file proves the pieces work
// together the way the pages use them, and that the honesty rules
// hold end to end: no forced picks, no invented data, no shipping
// claims, device-only history.

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

describe('Section 11 — guided quiz + budget finder share one ranker', () => {
  it('a quiz answer round-trips through the shareable ?answers= URL', () => {
    const answers: GuidedAnswers = {
      useCase: 'laptop for work',
      budgetUsd: 1000,
      brand: 'Apple',
      mustHaves: ['Long battery life'],
    };
    const decoded = decodeQuizAnswers(encodeQuizAnswers(answers));
    expect(decoded).toEqual(answers);
    // The decoded answers drive the same ranking input as the form.
    expect(answersToFinderInput(decoded as GuidedAnswers).budgetUsd).toBe(1000);
    expect(answersToFinderInput(decoded as GuidedAnswers).brand).toBe('Apple');
  });

  it('a tampered or unknown ?answers= value decodes to null, never to a guess', () => {
    expect(decodeQuizAnswers('not-json{')).toBeNull();
    expect(decodeQuizAnswers(null)).toBeNull();
    expect(
      decodeQuizAnswers(
        encodeURIComponent(JSON.stringify({ useCase: 'rocket ship', budgetUsd: 100, brand: null, mustHaves: [] }))
      )
    ).toBeNull();
  });

  it('the same ranker serves the Budget Finder with deal-first sorting', () => {
    const picks = rankGuidedPicks(
      [
        candidate({ slug: 'laptop-a', bestPriceUsd: 900, compareAtUsd: 1000 }),
        candidate({ slug: 'laptop-b', bestPriceUsd: 800, compareAtUsd: 1600 }),
        candidate({ slug: 'laptop-c', bestPriceUsd: 1200, compareAtUsd: 1500 }),
      ],
      { category: 'laptop', budgetUsd: 1000, sortBy: 'deal' }
    );
    // Over-budget laptop-c is dropped; biggest saving (50% off) wins.
    expect(picks.map((p) => p.slug)).toEqual(['laptop-b', 'laptop-a']);
    expect(picks[0].savingPct).toBe(50);
    expect(picks[0].verdict).toBe('Great deal');
  });

  it('no priced match returns an empty list — a pick is never forced', () => {
    const picks = rankGuidedPicks(
      [candidate({ slug: 'laptop-a', bestPriceUsd: 900 })],
      { category: 'laptop', budgetUsd: 100 }
    );
    expect(picks).toEqual([]);
  });

  it('the sample-laptop demo row is never a pick, even if passed in raw', () => {
    const picks = rankGuidedPicks(
      [candidate({ slug: 'sample-laptop', bestPriceUsd: 10, name: 'Sample Laptop' })],
      {}
    );
    expect(picks).toEqual([]);
  });

  it('unpriced products are never picks', () => {
    const picks = rankGuidedPicks(
      [candidate({ slug: 'laptop-a', bestPriceUsd: null })],
      {}
    );
    expect(picks).toEqual([]);
  });

  it('verdicts are earned only from real numbers', () => {
    expect(verdictForPick(25, null)).toBe('Great deal');
    expect(verdictForPick(12, null)).toBe('Good deal');
    expect(verdictForPick(null, 80)).toBe('Good time to buy');
    expect(verdictForPick(null, null)).toBe('Priced match');
  });

  it('budget-finder params: valid, missing, and invalid budgets', () => {
    // Section 14, Chunk 2 (B9): the parser now also returns the
    // amount as written (budgetOriginal / budgetCurrency) so the
    // page can show "20,000 PKR (≈ $71)" — a bare number stays USD.
    expect(parseBudgetFinderParams({ category: 'laptop', budget: '1000' })).toEqual({
      category: 'laptop',
      budgetUsd: 1000,
      budgetOriginal: 1000,
      budgetCurrency: 'USD',
      budgetError: null,
    });
    expect(parseBudgetFinderParams({})).toEqual({
      category: null,
      budgetUsd: null,
      budgetOriginal: null,
      budgetCurrency: null,
      budgetError: null,
    });
    const bad = parseBudgetFinderParams({ category: 'laptop', budget: 'free' });
    expect(bad.budgetUsd).toBeNull();
    expect(bad.budgetError).toMatch(/not a valid budget/);
    const negative = parseBudgetFinderParams({ budget: '-5' });
    expect(negative.budgetError).toMatch(/not a valid budget/);
  });
});

describe('Section 11 — store finder data (no shipping claims)', () => {
  it('PK has local stores and the worldwide fallback never duplicates them', () => {
    const { local, international, hasLocal } = getStoresSplit('PK');
    expect(hasLocal).toBe(true);
    expect(local.length).toBeGreaterThan(0);
    const slugs = [...local, ...international].map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('ZA has no confirmed local store — the finder must show the fallback, not fake one', () => {
    const { local, hasLocal } = getStoresSplit('ZA');
    expect(hasLocal).toBe(false);
    expect(local).toEqual([]);
  });

  it('a store search link is built from the store template + product name', () => {
    const { local } = getStoresSplit('PK');
    const url = buildStoreSearchUrl(local[0], 'MacBook Air 13');
    expect(url).toContain('MacBook');
    expect(() => new URL(url)).not.toThrow();
  });
});

describe('Section 11 — recently viewed is device-only history', () => {
  function memoryStorage(): Storage {
    let store: Record<string, string> = {};
    return {
      get length() {
        return Object.keys(store).length;
      },
      clear: () => {
        store = {};
      },
      getItem: (key: string) => store[key] ?? null,
      key: (index: number) => Object.keys(store)[index] ?? null,
      removeItem: (key: string) => {
        delete store[key];
      },
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    };
  }

  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: memoryStorage(),
      dispatchEvent: vi.fn(() => true),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records a product-page view and reads it back most-recent-first', () => {
    expect(getRecentlyViewed()).toEqual([]);
    recordRecentlyViewed({ id: 'p1', slug: 'macbook-air-13', name: 'MacBook Air 13', brand: 'Apple' });
    recordRecentlyViewed({ id: 'p2', slug: 'pixel-8', name: 'Pixel 8' });
    expect(getRecentlyViewed().map((i) => i.slug)).toEqual(['pixel-8', 'macbook-air-13']);
    clearRecentlyViewed();
    expect(getRecentlyViewed()).toEqual([]);
  });
});
