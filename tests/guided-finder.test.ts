import { describe, expect, it } from 'vitest';
import {
  answersToFinderInput,
  decodeQuizAnswers,
  encodeQuizAnswers,
  rankGuidedPicks,
  rankRelaxedGuidedPicks,
  verdictForPick,
  GUIDED_CATEGORIES,
  GUIDED_MUST_HAVES,
  GUIDED_USE_CASES,
  type GuidedAnswers,
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

describe('rankGuidedPicks', () => {
  it('applies the budget as a hard filter, never softening it', () => {
    const picks = rankGuidedPicks(
      [
        candidate({ slug: 'laptop-cheap', bestPriceUsd: 400 }),
        candidate({ slug: 'laptop-exact', bestPriceUsd: 500 }),
        candidate({ slug: 'laptop-over', bestPriceUsd: 501 }),
      ],
      { budgetUsd: 500 }
    );
    expect(picks.map((p) => p.slug)).toEqual(['laptop-cheap', 'laptop-exact']);
  });

  it('normalizes the category through the intent parser', () => {
    const products = [
      candidate({ slug: 'laptop-a', category: 'Laptops', bestPriceUsd: 500 }),
      candidate({ slug: 'phone-a', category: 'Phones', bestPriceUsd: 300 }),
    ];
    // "Laptops" (plural, capitalised) and "laptop" mean the same.
    expect(
      rankGuidedPicks(products, { category: 'Laptops' }).map((p) => p.slug)
    ).toEqual(['laptop-a']);
    expect(
      rankGuidedPicks(products, { category: 'laptop' }).map((p) => p.slug)
    ).toEqual(['laptop-a']);
    // An unknown category honestly returns nothing.
    expect(rankGuidedPicks(products, { category: 'toaster' })).toEqual([]);
  });

  it('filters by brand case-insensitively', () => {
    const picks = rankGuidedPicks(
      [
        candidate({ slug: 'apple-a', brand: 'Apple', bestPriceUsd: 900 }),
        candidate({ slug: 'dell-a', brand: 'Dell', bestPriceUsd: 700 }),
      ],
      { brand: 'apple' }
    );
    expect(picks.map((p) => p.slug)).toEqual(['apple-a']);
  });

  it('requires every must-have to match, on any of its keywords', () => {
    const products = [
      candidate({
        slug: 'laptop-battery',
        description: '24-hour battery life, lightweight chassis',
        bestPriceUsd: 800,
      }),
      candidate({
        slug: 'laptop-plain',
        description: 'A solid everyday laptop',
        bestPriceUsd: 600,
      }),
    ];
    // "Long battery life" matches on "battery"; "Lightweight"
    // matches on "lightweight" in the description.
    expect(
      rankGuidedPicks(products, { mustHaveKeywords: ['Long battery life', 'Lightweight'] }).map(
        (p) => p.slug
      )
    ).toEqual(['laptop-battery']);
    // A must-have nothing matches is an honest empty result.
    expect(
      rankGuidedPicks(products, { mustHaveKeywords: ['Waterproof'] })
    ).toEqual([]);
  });

  it('never picks unpriced products or the sample-laptop demo row', () => {
    const picks = rankGuidedPicks(
      [
        candidate({ slug: 'sample-laptop', name: 'Sample Laptop', bestPriceUsd: 1 }),
        candidate({ slug: 'phone-a', category: 'Phones', bestPriceUsd: null }),
        candidate({ slug: 'phone-b', category: 'Phones', bestPriceUsd: 0 }),
        candidate({ slug: 'phone-c', category: 'Phones', bestPriceUsd: 200 }),
      ],
      {}
    );
    expect(picks.map((p) => p.slug)).toEqual(['phone-c']);
  });

  it('returns an empty list (never a forced pick) for impossible combos', () => {
    const products = [candidate({ slug: 'laptop-a', bestPriceUsd: 900 })];
    expect(rankGuidedPicks(products, { budgetUsd: 10 })).toEqual([]);
    expect(rankGuidedPicks([], { budgetUsd: 1000 })).toEqual([]);
    expect(
      rankGuidedPicks(products, { budgetUsd: 1000, brand: 'Sony' })
    ).toEqual([]);
    // Invalid budgets are treated as "no limit", not as $0.
    expect(
      rankGuidedPicks(products, { budgetUsd: -50 }).map((p) => p.slug)
    ).toEqual(['laptop-a']);
    expect(
      rankGuidedPicks(products, { budgetUsd: Number.NaN }).map((p) => p.slug)
    ).toEqual(['laptop-a']);
  });

  it('ranks by relevance, then saving, then Deal Score, then price', () => {
    const picks = rankGuidedPicks(
      [
        candidate({ slug: 'b-no-deal', brand: 'Apple', bestPriceUsd: 800, compareAtUsd: null, dealScore: null }),
        candidate({ slug: 'a-deal', brand: 'Apple', bestPriceUsd: 700, compareAtUsd: 1000, dealScore: 60 }),
        candidate({ slug: 'c-score', brand: 'Apple', bestPriceUsd: 700, compareAtUsd: 1000, dealScore: 90 }),
        candidate({ slug: 'd-other-brand', brand: 'Dell', bestPriceUsd: 100, compareAtUsd: 1000, dealScore: 99 }),
      ],
      { brand: 'Apple' }
    );
    // Brand filter drops d-other-brand. Among Apple picks the
    // 30%-off pair beats the no-saving pick; within the pair the
    // higher Deal Score wins.
    expect(picks.map((p) => p.slug)).toEqual(['c-score', 'a-deal', 'b-no-deal']);
  });

  it('breaks remaining ties deterministically by lowest price, then slug', () => {
    const picks = rankGuidedPicks(
      [
        candidate({ slug: 'laptop-z', bestPriceUsd: 300 }),
        candidate({ slug: 'laptop-a', bestPriceUsd: 300 }),
        candidate({ slug: 'laptop-cheap', bestPriceUsd: 200 }),
      ],
      {}
    );
    expect(picks.map((p) => p.slug)).toEqual(['laptop-cheap', 'laptop-a', 'laptop-z']);
  });

  it('respects the limit', () => {
    const products = Array.from({ length: 8 }, (_, i) =>
      candidate({ slug: `p-${i}`, bestPriceUsd: 100 + i })
    );
    expect(rankGuidedPicks(products, { limit: 3 })).toHaveLength(3);
  });

  it('builds why-lines only from facts that are true', () => {
    const [pick] = rankGuidedPicks(
      [
        candidate({
          slug: 'laptop-a',
          brand: 'Apple',
          bestPriceUsd: 800,
          compareAtUsd: 1000,
          merchantName: 'Best Buy',
          dealScore: 80,
        }),
      ],
      { budgetUsd: 1000, brand: 'Apple' }
    );
    expect(pick.why).toContain('$800.00 — within your $1000.00 budget');
    expect(pick.why).toContain('From your preferred brand Apple');
    expect(pick.why).toContain('Save 20% vs $1000.00 ($200.00)');
    expect(pick.why).toContain('Deal Score 80/100');
    expect(pick.savingPct).toBe(20);
  });
});

describe('verdictForPick', () => {
  it('uses thresholds on real numbers only', () => {
    expect(verdictForPick(25, null)).toBe('Great deal');
    expect(verdictForPick(20, null)).toBe('Great deal');
    expect(verdictForPick(15, null)).toBe('Good deal');
    expect(verdictForPick(null, 80)).toBe('Good time to buy');
    expect(verdictForPick(null, 70)).toBe('Priced match');
    expect(verdictForPick(null, null)).toBe('Priced match');
    expect(verdictForPick(5, null)).toBe('Priced match');
  });
});

describe('quiz answers URL round-trip', () => {
  const answers: GuidedAnswers = {
    useCase: 'laptop for work',
    budgetUsd: 1000,
    brand: 'Apple',
    mustHaves: ['Long battery life'],
  };

  it('encodes and decodes the same answers', () => {
    expect(decodeQuizAnswers(encodeQuizAnswers(answers))).toEqual(answers);
  });

  it('rejects tampered or malformed links instead of guessing', () => {
    expect(decodeQuizAnswers(null)).toBeNull();
    expect(decodeQuizAnswers('')).toBeNull();
    expect(decodeQuizAnswers('not-json')).toBeNull();
    expect(decodeQuizAnswers(encodeURIComponent('{"useCase":"toaster"}'))).toBeNull();
    expect(
      decodeQuizAnswers(
        encodeURIComponent(JSON.stringify({ ...answers, brand: 'NoSuchBrand' }))
      )
    ).toBeNull();
    expect(
      decodeQuizAnswers(
        encodeURIComponent(JSON.stringify({ ...answers, mustHaves: ['Free pizza'] }))
      )
    ).toBeNull();
    expect(
      decodeQuizAnswers(
        encodeURIComponent(JSON.stringify({ ...answers, budgetUsd: -5 }))
      )
    ).toBeNull();
  });

  it('derives the category from the use-case text via the intent parser', () => {
    const input = answersToFinderInput(answers);
    expect(input.category).toBe('laptop');
    expect(input.budgetUsd).toBe(1000);
    expect(input.brand).toBe('Apple');
    expect(input.mustHaveKeywords).toEqual(['Long battery life']);
    expect(input.sortBy).toBe('match');
    expect(answersToFinderInput({ ...answers, useCase: 'camera for photography' }).category).toBe(
      'camera'
    );
  });
});

describe('rankRelaxedGuidedPicks (B1 nearest-miss fallback)', () => {
  const products = [
    candidate({
      slug: 'laptop-battery',
      name: 'Battery Laptop',
      description: '24-hour battery life, lightweight chassis',
      bestPriceUsd: 800,
    }),
    candidate({
      slug: 'laptop-waterproof',
      name: 'Tough Laptop',
      description: 'Waterproof rugged laptop, sealed ports',
      bestPriceUsd: 900,
    }),
    candidate({
      slug: 'laptop-plain',
      name: 'Plain Laptop',
      description: 'A solid everyday laptop',
      bestPriceUsd: 600,
    }),
  ];

  it('returns closest picks with each missed must-have labelled', () => {
    const relaxed = rankRelaxedGuidedPicks(products, {
      mustHaveKeywords: ['Long battery life', 'Waterproof'],
    });
    // Both battery laptops match 1 of 2 (battery, not waterproof);
    // the plain laptop matches 0 and is not a closest match.
    expect(relaxed.map((p) => p.slug)).toEqual(['laptop-battery', 'laptop-waterproof']);
    expect(relaxed[0].matchedMustHaveCount).toBe(1);
    expect(relaxed[0].totalMustHaves).toBe(2);
    expect(relaxed[0].missedMustHaves).toEqual(['Waterproof']);
  });

  it('ranks most matched must-haves first', () => {
    const relaxed = rankRelaxedGuidedPicks(products, {
      mustHaveKeywords: ['Long battery life', 'Lightweight', 'Waterproof'],
    });
    // laptop-battery matches battery + lightweight (2); the rugged
    // one matches battery + waterproof (2) — tie broken by price;
    // the plain laptop matches 0 and is dropped.
    expect(relaxed.map((p) => p.slug)).toEqual(['laptop-battery', 'laptop-waterproof']);
    expect(relaxed[0].matchedMustHaveCount).toBe(2);
  });

  it('keeps budget, category and brand hard even when relaxing', () => {
    // Over-budget and wrong-brand closest matches are never picks.
    expect(
      rankRelaxedGuidedPicks(products, {
        budgetUsd: 700,
        mustHaveKeywords: ['Long battery life', 'Waterproof'],
      })
    ).toEqual([]);
    expect(
      rankRelaxedGuidedPicks(products, {
        brand: 'Sony',
        mustHaveKeywords: ['Long battery life', 'Waterproof'],
      })
    ).toEqual([]);
    expect(
      rankRelaxedGuidedPicks(products, {
        category: 'phone',
        mustHaveKeywords: ['Long battery life', 'Waterproof'],
      })
    ).toEqual([]);
  });

  it('returns [] with no must-haves, and caps at 3 by default', () => {
    expect(rankRelaxedGuidedPicks(products, {})).toEqual([]);
    expect(rankRelaxedGuidedPicks(products, { mustHaveKeywords: [] })).toEqual([]);
    const many = Array.from({ length: 6 }, (_, i) =>
      candidate({
        slug: `p-${i}`,
        description: 'waterproof laptop',
        bestPriceUsd: 100 + i,
      })
    );
    expect(
      rankRelaxedGuidedPicks(many, { mustHaveKeywords: ['Waterproof', 'Lightweight'] })
    ).toHaveLength(3);
  });

  it('never picks unpriced products or the sample-laptop demo row', () => {
    const relaxed = rankRelaxedGuidedPicks(
      [
        candidate({ slug: 'sample-laptop', description: 'waterproof laptop', bestPriceUsd: 1 }),
        candidate({ slug: 'unpriced', description: 'waterproof laptop', bestPriceUsd: null }),
        candidate({ slug: 'ok', description: 'waterproof laptop', bestPriceUsd: 200 }),
      ],
      { mustHaveKeywords: ['Waterproof', 'Lightweight'] }
    );
    expect(relaxed.map((p) => p.slug)).toEqual(['ok']);
  });
});

describe('guided finder option lists (B13 expansion)', () => {
  it('adds the video-editing + phone-photography use cases', () => {
    expect(GUIDED_USE_CASES.map((u) => u.value)).toContain('laptop for video editing');
    expect(GUIDED_USE_CASES.map((u) => u.value)).toContain('phone for photography');
    // The new use cases still derive a category via the parser.
    expect(
      answersToFinderInput({
        useCase: 'laptop for video editing',
        budgetUsd: null,
        brand: null,
        mustHaves: [],
      }).category
    ).toBe('laptop');
    expect(
      answersToFinderInput({
        useCase: 'phone for photography',
        budgetUsd: null,
        brand: null,
        mustHaves: [],
      }).category
    ).toBe('phone');
  });

  it('adds the 5G / touchscreen / noise-cancelling must-haves and the Mouse category', () => {
    expect(GUIDED_MUST_HAVES).toContain('5G connectivity');
    expect(GUIDED_MUST_HAVES).toContain('Touchscreen');
    expect(GUIDED_MUST_HAVES).toContain('Noise cancelling');
    expect(GUIDED_CATEGORIES).toContain('Mouse');
  });

  it('round-trips a shared link carrying a new must-have', () => {
    const answers: GuidedAnswers = {
      useCase: 'phone for photography',
      budgetUsd: 1000,
      brand: null,
      mustHaves: ['5G connectivity'],
    };
    expect(decodeQuizAnswers(encodeQuizAnswers(answers))).toEqual(answers);
  });
});
