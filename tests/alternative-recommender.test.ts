import { describe, expect, it } from 'vitest';
import {
  BUDGET_ALTERNATIVE_MIN_SIMILARITY,
  DIGEST_RECOMMENDATION_MAX,
  DIGEST_RECOMMENDATION_MIN_SIMILARITY,
  selectBudgetAlternative,
  selectVectorRecommendations,
  type BudgetAlternativeCandidate,
} from '@/services/alternative-recommender';

function candidate(
  partial: Partial<BudgetAlternativeCandidate> & { id: string }
): BudgetAlternativeCandidate {
  return {
    slug: `slug-${partial.id}`,
    name: `Product ${partial.id}`,
    brand: 'Brand',
    similarity: 0.99,
    lowestPriceUsd: 500,
    ...partial,
  };
}

describe('BUDGET_ALTERNATIVE_MIN_SIMILARITY', () => {
  it('is exactly 0.95 — the "95%+ match" bar', () => {
    expect(BUDGET_ALTERNATIVE_MIN_SIMILARITY).toBe(0.95);
  });
});

describe('selectBudgetAlternative — the 0.95 threshold is hard', () => {
  it('accepts a match at exactly 0.95 within budget', () => {
    const best = selectBudgetAlternative(
      [candidate({ id: 'a', similarity: 0.95, lowestPriceUsd: 999 })],
      1000
    );
    expect(best?.id).toBe('a');
    expect(best?.similarity).toBe(0.95);
  });

  it('rejects 0.949 — never rounds up to a "95%+ match"', () => {
    expect(
      selectBudgetAlternative(
        [candidate({ id: 'a', similarity: 0.949, lowestPriceUsd: 500 })],
        1000
      )
    ).toBeNull();
  });

  it('rejects a high-similarity match that is over budget', () => {
    // 0.99 similarity but $1,500 against a $1,000 budget: no deal.
    expect(
      selectBudgetAlternative(
        [candidate({ id: 'a', similarity: 0.99, lowestPriceUsd: 1500 })],
        1000
      )
    ).toBeNull();
  });

  it('accepts a match priced exactly at the budget', () => {
    expect(
      selectBudgetAlternative(
        [candidate({ id: 'a', similarity: 0.97, lowestPriceUsd: 1000 })],
        1000
      )?.id
    ).toBe('a');
  });

  it('rejects unpriced matches — no price, no alternative', () => {
    expect(
      selectBudgetAlternative(
        [candidate({ id: 'a', similarity: 0.99, lowestPriceUsd: null })],
        1000
      )
    ).toBeNull();
  });

  it('picks the highest similarity among qualifying matches', () => {
    const best = selectBudgetAlternative(
      [
        candidate({ id: 'a', similarity: 0.96, lowestPriceUsd: 900 }),
        candidate({ id: 'b', similarity: 0.99, lowestPriceUsd: 800 }),
        candidate({ id: 'c', similarity: 0.98, lowestPriceUsd: 950 }),
      ],
      1000
    );
    expect(best?.id).toBe('b');
  });

  it('returns null for an empty list', () => {
    expect(selectBudgetAlternative([], 1000)).toBeNull();
  });
});

describe('selectVectorRecommendations — digest "similar" picks', () => {
  function rec(
    partial: Partial<BudgetAlternativeCandidate> & {
      id: string;
      basedOnProductId: string;
      basedOnProductName: string;
    }
  ) {
    return { ...candidate(partial), basedOnProductId: partial.basedOnProductId, basedOnProductName: partial.basedOnProductName };
  }

  it('uses the documented 0.80 bar, not the 0.95 bar', () => {
    expect(DIGEST_RECOMMENDATION_MIN_SIMILARITY).toBe(0.8);
    const picks = selectVectorRecommendations(
      [rec({ id: 'a', similarity: 0.85, basedOnProductId: 's1', basedOnProductName: 'Source' })],
      new Set(['s1'])
    );
    expect(picks.map((p) => p.id)).toEqual(['a']);
  });

  it('drops matches below 0.80', () => {
    expect(
      selectVectorRecommendations(
        [rec({ id: 'a', similarity: 0.79, basedOnProductId: 's1', basedOnProductName: 'Source' })],
        new Set(['s1'])
      )
    ).toEqual([]);
  });

  it('excludes the source products and anything already saved', () => {
    const picks = selectVectorRecommendations(
      [
        rec({ id: 's1', similarity: 0.99, basedOnProductId: 's1', basedOnProductName: 'Source' }),
        rec({ id: 'saved', similarity: 0.95, basedOnProductId: 's1', basedOnProductName: 'Source' }),
        rec({ id: 'new', similarity: 0.9, basedOnProductId: 's1', basedOnProductName: 'Source' }),
      ],
      new Set(['s1', 'saved'])
    );
    expect(picks.map((p) => p.id)).toEqual(['new']);
  });

  it('dedupes by product, keeping the highest similarity', () => {
    const picks = selectVectorRecommendations(
      [
        rec({ id: 'a', similarity: 0.85, basedOnProductId: 's1', basedOnProductName: 'One' }),
        rec({ id: 'a', similarity: 0.93, basedOnProductId: 's2', basedOnProductName: 'Two' }),
      ],
      new Set(['s1', 's2'])
    );
    expect(picks).toHaveLength(1);
    expect(picks[0].similarity).toBe(0.93);
    expect(picks[0].basedOnProductName).toBe('Two');
  });

  it('requires a real price and caps the list', () => {
    expect(DIGEST_RECOMMENDATION_MAX).toBe(6);
    const picks = selectVectorRecommendations(
      [
        rec({ id: 'unpriced', similarity: 0.95, lowestPriceUsd: null, basedOnProductId: 's1', basedOnProductName: 'Source' }),
        ...Array.from({ length: 8 }, (_, i) =>
          rec({ id: `p${i}`, similarity: 0.9 - i * 0.01, basedOnProductId: 's1', basedOnProductName: 'Source' })
        ),
      ],
      new Set(['s1'])
    );
    expect(picks).toHaveLength(6);
    expect(picks.every((p) => p.id !== 'unpriced')).toBe(true);
    expect(picks[0].similarity).toBeGreaterThanOrEqual(picks[5].similarity);
  });
});
