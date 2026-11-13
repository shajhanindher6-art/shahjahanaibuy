/**
 * Section 19, Phase 4 (§12 #36–#39, #46, #47) — budget tools.
 *
 * Pure-function tests: potential savings, the "need by" timeline,
 * the per-category bundle split, the tech-budget over-budget
 * explanation, structured spec inputs in the guided finder, and
 * value-ranked similar products. No DB, no network.
 */
import { describe, expect, it } from 'vitest';
import {
  describePotentialSavings,
  savingsVsAlternative,
  savingsVsBudget,
  savingsVsCompareAt,
} from '@/lib/budget-savings';
import { NEED_BY_NEAR_DAYS, parseNeedByDate, timelineAdvice } from '@/lib/budget-timeline';
import { rankSimilarByValue } from '@/lib/similar-value';
import { allocateBundle, type BundleCandidate } from '@/services/bundle-allocator';
import {
  explainTechBudgetOverrun,
  type TechBudgetItem,
} from '@/services/tech-budget';
import {
  GUIDED_SPEC_DATA_NOTE,
  parseBudgetFinderParams,
  rankGuidedPicks,
  specOptionsForCategory,
  specValueMatches,
  validateSpecInputs,
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

function bundleCandidate(partial: Partial<BundleCandidate> & { slug: string }): BundleCandidate {
  return {
    id: partial.slug,
    name: partial.slug,
    brand: null,
    category: 'Laptops',
    lowestPriceUsd: 100,
    ...partial,
  };
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('§12 #36 — potential savings', () => {
  it('computes dollars + % saved by choosing the cheaper alternative', () => {
    const saving = savingsVsAlternative(1000, 800);
    expect(saving).toEqual({ savedUsd: 200, savedPct: 20, alternativeIsMoreExpensive: false });
  });

  it('reports a more expensive alternative honestly instead of clamping to zero', () => {
    const saving = savingsVsAlternative(800, 1000);
    expect(saving?.savedUsd).toBe(-200);
    expect(saving?.alternativeIsMoreExpensive).toBe(true);
  });

  it('returns null when either price is unrecorded — no invented saving', () => {
    expect(savingsVsAlternative(null, 800)).toBeNull();
    expect(savingsVsAlternative(1000, null)).toBeNull();
    expect(savingsVsCompareAt(800, null)).toBeNull();
    expect(savingsVsCompareAt(800, 800)).toBeNull();
  });

  it('computes dollars + % saved vs the compare-at price', () => {
    expect(savingsVsCompareAt(900, 1000)).toEqual({ savedUsd: 100, savedPct: 10 });
  });

  it('computes money left of the budget, and the over-budget amount', () => {
    expect(savingsVsBudget(800, 1000)).toMatchObject({
      remainingUsd: 200,
      overBudget: false,
      overByUsd: 0,
      budgetUsedPct: 80,
    });
    expect(savingsVsBudget(1200, 1000)).toMatchObject({
      remainingUsd: -200,
      overBudget: true,
      overByUsd: 200,
    });
    expect(savingsVsBudget(800, null)).toBeNull();
  });

  it('describes the saving in one honest sentence, omitting missing parts', () => {
    expect(
      describePotentialSavings({ priceUsd: 900, compareAtUsd: 1000, budgetUsd: 1000 })
    ).toBe('Save $100.00 (10%) vs the $1000.00 was-price · $100.00 left of your $1000.00 budget');
    expect(describePotentialSavings({ priceUsd: null })).toBeNull();
    expect(
      describePotentialSavings({ priceUsd: 1200, budgetUsd: 1000 })
    ).toBe('$200.00 over your $1000.00 budget');
  });

  it('guided picks carry the saving in dollars and the money left of the budget', () => {
    const picks = rankGuidedPicks(
      [candidate({ slug: 'laptop-a', bestPriceUsd: 900, compareAtUsd: 1000 })],
      { budgetUsd: 1000 }
    );
    expect(picks).toHaveLength(1);
    expect(picks[0].savingsUsd).toBe(100);
    expect(picks[0].savingPct).toBe(10);
    expect(picks[0].savingsVsBudgetUsd).toBe(100);
    expect(picks[0].why.join(' ')).toContain('$100.00 left of your $1000.00 budget');
  });
});

describe('§12 #37 — timeline / "need by" input', () => {
  it('parses a valid future date and rejects past/malformed ones', () => {
    expect(parseNeedByDate(daysFromNow(5)).error).toBeNull();
    expect(parseNeedByDate(daysFromNow(5)).date).not.toBeNull();
    expect(parseNeedByDate('2026-02-30').error).toMatch(/not a real calendar date/);
    expect(parseNeedByDate('next Friday').error).toMatch(/not a valid date/);
    expect(parseNeedByDate(daysFromNow(-1)).error).toMatch(/in the past/);
    expect(parseNeedByDate(null)).toEqual({ date: null, error: null });
    expect(parseNeedByDate('')).toEqual({ date: null, error: null });
  });

  it('a near deadline does NOT offer waiting — no drop can be predicted', () => {
    const advice = timelineAdvice(parseNeedByDate(daysFromNow(5)).date);
    expect(advice?.deadlineNear).toBe(true);
    expect(advice?.waitOffered).toBe(false);
    expect(advice?.daysUntil).toBe(5);
    expect(advice?.note).toMatch(/too soon to wait for a price drop/);
    expect(advice?.note).toMatch(/only 4 recorded price points/);
  });

  it('a far deadline keeps waiting possible in principle, but predicts no drop', () => {
    const advice = timelineAdvice(parseNeedByDate(daysFromNow(60)).date);
    expect(advice?.deadlineNear).toBe(false);
    expect(advice?.waitOffered).toBe(true);
    expect(advice?.note).toMatch(/no price drop is predicted/);
  });

  it('the near-deadline threshold is 14 days', () => {
    expect(NEED_BY_NEAR_DAYS).toBe(14);
    expect(timelineAdvice(parseNeedByDate(daysFromNow(14)).date)?.deadlineNear).toBe(true);
    expect(timelineAdvice(parseNeedByDate(daysFromNow(15)).date)?.deadlineNear).toBe(false);
  });

  it('guided picks carry the timeline note and waitRecommended=false on a near deadline', () => {
    const picks = rankGuidedPicks(
      [candidate({ slug: 'laptop-a', bestPriceUsd: 500 })],
      { needBy: daysFromNow(3) }
    );
    expect(picks).toHaveLength(1);
    expect(picks[0].waitRecommended).toBe(false);
    expect(picks[0].timelineNote).toMatch(/in 3 days/);
    const far = rankGuidedPicks(
      [candidate({ slug: 'laptop-a', bestPriceUsd: 500 })],
      { needBy: daysFromNow(60) }
    );
    expect(far[0].waitRecommended).toBe(true);
    expect(far[0].timelineNote).toMatch(/in 60 days/);
  });

  it('an invalid deadline in the Budget Finder params is an error, not a silent default', () => {
    const parsed = parseBudgetFinderParams({ budget: '1000', needBy: 'yesterday' });
    expect(parsed.needBy).toBeNull();
    expect(parsed.needByError).toMatch(/not a valid date/);
    const ok = parseBudgetFinderParams({ budget: '1000', needBy: daysFromNow(10) });
    expect(ok.needBy).toBe(daysFromNow(10));
    expect(ok.needByError).toBeNull();
  });
});

describe('§12 #38 — per-category budget split in the bundle allocator', () => {
  it('splits the budget equally across categories with spend + remaining per category', () => {
    const result = allocateBundle({
      budgetUsd: 1000,
      categories: ['Laptops', 'Phones'],
      products: [
        bundleCandidate({ slug: 'laptop-a', category: 'Laptops', lowestPriceUsd: 400 }),
        bundleCandidate({ slug: 'phone-a', category: 'Phones', lowestPriceUsd: 300 }),
      ],
    });
    expect(result.totalSpendUsd).toBe(700);
    expect(result.withinBudget).toBe(true);
    expect(result.categoryAllocations).toEqual([
      { category: 'Laptops', allocatedUsd: 500, spentUsd: 400, remainingUsd: 100, productSlug: 'laptop-a' },
      { category: 'Phones', allocatedUsd: 500, spentUsd: 300, remainingUsd: 200, productSlug: 'phone-a' },
    ]);
  });

  it('the shares sum to the budget (rounding remainder to the first category)', () => {
    const result = allocateBundle({
      budgetUsd: 100,
      categories: ['A', 'B', 'C'],
      products: [
        bundleCandidate({ slug: 'a', category: 'A', lowestPriceUsd: 10 }),
        bundleCandidate({ slug: 'b', category: 'B', lowestPriceUsd: 10 }),
        bundleCandidate({ slug: 'c', category: 'C', lowestPriceUsd: 10 }),
      ],
    });
    const sum = result.categoryAllocations.reduce((s, a) => s + a.allocatedUsd, 0);
    expect(Math.round(sum * 100) / 100).toBe(100);
    expect(result.categoryAllocations[0].allocatedUsd).toBe(33.34);
  });

  it('an uncovered category keeps its whole share unspent, and the total never exceeds the budget', () => {
    const result = allocateBundle({
      budgetUsd: 150,
      categories: ['Laptops', 'Phones'],
      products: [bundleCandidate({ slug: 'laptop-a', category: 'Laptops', lowestPriceUsd: 400 })],
    });
    expect(result.totalSpendUsd).toBe(0);
    expect(result.categoryAllocations).toEqual([
      { category: 'Laptops', allocatedUsd: 75, spentUsd: 0, remainingUsd: 75, productSlug: null },
      { category: 'Phones', allocatedUsd: 75, spentUsd: 0, remainingUsd: 75, productSlug: null },
    ]);
  });

  it('a category whose pick costs more than its share reports remaining 0 (not negative)', () => {
    const result = allocateBundle({
      budgetUsd: 1000,
      categories: ['Laptops', 'Phones'],
      products: [
        bundleCandidate({ slug: 'laptop-a', category: 'Laptops', lowestPriceUsd: 800 }),
        bundleCandidate({ slug: 'phone-a', category: 'Phones', lowestPriceUsd: 100 }),
      ],
    });
    expect(result.totalSpendUsd).toBe(900);
    expect(result.categoryAllocations[0]).toMatchObject({
      allocatedUsd: 500,
      spentUsd: 800,
      remainingUsd: 0,
    });
  });
});

describe('§12 #39 — tech-budget over-budget explanation', () => {
  const items: TechBudgetItem[] = [
    { productId: 'p1', slug: 'macbook-air', name: 'MacBook Air', category: 'Laptops', priceUsd: 999 },
    { productId: 'p2', slug: 'sony-xm5', name: 'Sony WH-1000XM5', category: 'Headphones', priceUsd: 399 },
    { productId: 'p3', slug: 'logitech-mx', name: 'Logitech MX Master', category: 'Mouse', priceUsd: 99 },
  ];

  it('returns null when the wishlist fits the budget', () => {
    expect(
      explainTechBudgetOverrun({ monthlyBudgetUsd: 2000, totalUsd: 1497, items })
    ).toBeNull();
  });

  it('names the drivers with their share of the total', () => {
    const overrun = explainTechBudgetOverrun({ monthlyBudgetUsd: 1000, totalUsd: 1497, items });
    expect(overrun?.overByUsd).toBe(497);
    expect(overrun?.drivers[0]).toMatchObject({ name: 'MacBook Air', priceUsd: 999, sharePct: 66.7 });
    expect(overrun?.drivers).toHaveLength(3);
  });

  it('says which items to drop so the total fits, fewest removals first', () => {
    const overrun = explainTechBudgetOverrun({ monthlyBudgetUsd: 1000, totalUsd: 1497, items });
    expect(overrun?.dropToFit).toEqual({
      names: ['MacBook Air'],
      removedUsd: 999,
      newTotalUsd: 498,
    });
  });

  it('offers a real in-budget replacement budget for the top driver', () => {
    const overrun = explainTechBudgetOverrun({ monthlyBudgetUsd: 1000, totalUsd: 1497, items });
    // Replacing the $999 laptop while keeping the $498 rest in budget
    // leaves $502 for the replacement.
    expect(overrun?.replacementBudgetUsd).toBe(502);
    expect(overrun?.replacementCategory).toBe('Laptops');
  });
});

describe('§12 #46 — structured spec inputs for the guided finder', () => {
  it('offers RAM/storage for laptops and battery for watches', () => {
    expect(specOptionsForCategory('laptop').map((o) => o.key)).toEqual(['ram', 'storage']);
    expect(specOptionsForCategory('watch').map((o) => o.key)).toEqual(['battery']);
    expect(specOptionsForCategory('toaster')).toEqual([]);
  });

  it('drops unknown spec keys/values instead of guessing', () => {
    expect(validateSpecInputs('laptop', { ram: '16 GB', bogus: 'x', storage: '9 TB' })).toEqual({
      ram: '16 GB',
    });
  });

  it('matches "16 GB" against "16GB RAM" in the product text', () => {
    expect(specValueMatches('16 GB', 'MacBook Air 16GB RAM laptop')).toBe(true);
    expect(specValueMatches('32 GB', 'MacBook Air 16GB RAM laptop')).toBe(false);
  });

  it('a spec input is a hard filter, and the match is labelled as a text mention', () => {
    const picks = rankGuidedPicks(
      [
        candidate({ slug: 'laptop-16gb', bestPriceUsd: 500, description: '16GB RAM, fast laptop' }),
        candidate({ slug: 'laptop-8gb', bestPriceUsd: 400, description: '8GB RAM laptop' }),
      ],
      { category: 'laptop', specInputs: { ram: '16 GB' } }
    );
    expect(picks.map((p) => p.slug)).toEqual(['laptop-16gb']);
    expect(picks[0].specMatches).toEqual(['RAM: 16 GB']);
    expect(picks[0].why.join(' ')).toContain('Mentions your specs: RAM: 16 GB');
  });

  it('an unknown spec value never filters anything (validated away)', () => {
    const picks = rankGuidedPicks(
      [candidate({ slug: 'laptop-a', bestPriceUsd: 500 })],
      { category: 'laptop', specInputs: { ram: '9 TB' } }
    );
    expect(picks).toHaveLength(1);
  });

  it('Budget Finder params parse spec_* inputs against the category options', () => {
    const parsed = parseBudgetFinderParams({
      category: 'laptop',
      budget: '1000',
      spec_ram: '16 GB',
      spec_bogus: 'x',
    });
    expect(parsed.specInputs).toEqual({ ram: '16 GB' });
  });

  it('the spec-data caveat says no structured spec data is recorded', () => {
    expect(GUIDED_SPEC_DATA_NOTE).toMatch(/No structured specification data is recorded/);
    expect(GUIDED_SPEC_DATA_NOTE).toMatch(/matched against product names and descriptions only/);
  });
});

describe('§12 #47 — value-ranked similar products', () => {
  it('orders by real saving % first, then lowest price, then match score', () => {
    const ranked = rankSimilarByValue([
      { slug: 'cheap-no-saving', price: 100, savingPct: null, matchScore: 90 },
      { slug: 'pricey-big-saving', price: 800, savingPct: 30, matchScore: 50 },
      { slug: 'cheap-small-saving', price: 150, savingPct: 10, matchScore: 80 },
      { slug: 'cheapest-big-saving', price: 700, savingPct: 30, matchScore: 60 },
    ]);
    expect(ranked.map((r) => r.slug)).toEqual([
      'cheapest-big-saving',
      'pricey-big-saving',
      'cheap-small-saving',
      'cheap-no-saving',
    ]);
  });

  it('unpriced products rank last — no price, no value claim', () => {
    const ranked = rankSimilarByValue([
      { slug: 'unpriced', price: null, savingPct: null, matchScore: 99 },
      { slug: 'priced', price: 500, savingPct: null, matchScore: 50 },
    ]);
    expect(ranked.map((r) => r.slug)).toEqual(['priced', 'unpriced']);
  });

  it('a null saving ranks below any real saving, never as 0%', () => {
    const ranked = rankSimilarByValue([
      { slug: 'no-saving', price: 100, savingPct: null, matchScore: 99 },
      { slug: 'tiny-saving', price: 900, savingPct: 1, matchScore: 50 },
    ]);
    expect(ranked[0].slug).toBe('tiny-saving');
  });
});
