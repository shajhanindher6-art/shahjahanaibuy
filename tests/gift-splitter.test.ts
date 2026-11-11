import { describe, expect, it } from 'vitest';
import {
  parseGiftSplitParams,
  splitGiftBudget,
  suggestPicksForSplit,
  validateGiftSplitInput,
  type GiftRecipientInput,
} from '@/lib/gift-splitter';
import type { GiftCandidate } from '@/services/gift-finder';

const CANDIDATES: GiftCandidate[] = [
  {
    id: '1',
    name: 'Laptop Stand',
    slug: 'laptop-stand',
    brand: 'Brand A',
    category: 'laptops',
    description: 'A sturdy laptop stand',
    bestPriceUsd: 40,
    compareAtUsd: 50,
    merchantName: 'Amazon',
    couponLabel: null,
  },
  {
    id: '2',
    name: 'Headphones',
    slug: 'headphones',
    brand: 'Brand B',
    category: 'headphones',
    description: 'Wireless headphones',
    bestPriceUsd: 120,
    compareAtUsd: 150,
    merchantName: 'Amazon',
    couponLabel: null,
  },
  {
    id: '3',
    name: 'Sample Laptop',
    slug: 'sample-laptop',
    brand: 'Demo',
    category: 'laptops',
    description: 'Demo row — never a pick',
    bestPriceUsd: 10,
    compareAtUsd: null,
    merchantName: 'Amazon',
    couponLabel: null,
  },
];

function recipient(name: string, weight: number | null = null): GiftRecipientInput {
  return { name, interests: [], weight };
}

describe('splitGiftBudget', () => {
  it('equal split divides the total exactly, to the cent', () => {
    const result = splitGiftBudget(100, [recipient('A'), recipient('B'), recipient('C')]);
    expect(result.isEqualSplit).toBe(true);
    expect(result.shares.map((s) => s.shareUsd)).toEqual([33.34, 33.33, 33.33]);
    const sum = result.shares.reduce((s, x) => s + x.shareUsd, 0);
    expect(sum).toBeCloseTo(100, 2);
  });

  it('user-entered weights split proportionally; unweighted recipients get weight 1', () => {
    const result = splitGiftBudget(100, [
      recipient('A', 2),
      recipient('B'),
    ]);
    expect(result.isEqualSplit).toBe(false);
    expect(result.shares[0].shareUsd).toBeCloseTo(66.67, 2);
    expect(result.shares[1].shareUsd).toBeCloseTo(33.33, 2);
  });

  it('single recipient gets the whole total', () => {
    const result = splitGiftBudget(59.99, [recipient('Solo')]);
    expect(result.shares).toHaveLength(1);
    expect(result.shares[0].shareUsd).toBe(59.99);
  });
});

describe('validateGiftSplitInput', () => {
  it('rejects zero/negative totals, no recipients, blank names', () => {
    expect(validateGiftSplitInput(0, [recipient('A')])).toMatch(/above \$0/);
    expect(validateGiftSplitInput(100, [])).toMatch(/at least one/);
    expect(validateGiftSplitInput(100, [recipient('  ')])).toMatch(/needs a name/);
  });

  it('rejects duplicate names and non-positive weights', () => {
    expect(validateGiftSplitInput(100, [recipient('A'), recipient('a')])).toMatch(/different/);
    expect(validateGiftSplitInput(100, [recipient('A', 0)])).toMatch(/positive/);
    expect(validateGiftSplitInput(100, [recipient('A', NaN)])).toMatch(/positive/);
  });

  it('accepts a valid equal split', () => {
    expect(validateGiftSplitInput(100, [recipient('A'), recipient('B')])).toBeNull();
  });
});

describe('suggestPicksForSplit', () => {
  it('one pick per recipient, never over that recipient’s share', () => {
    const result = splitGiftBudget(160, [recipient('A'), recipient('B')]);
    const picks = suggestPicksForSplit(CANDIDATES, result.shares);
    expect(picks).toHaveLength(2);
    // Each share is $80: the $40 stand fits, the $120 headphones do not.
    for (const { share, pick } of picks) {
      expect(pick).not.toBeNull();
      expect((pick as NonNullable<typeof pick>).bestPriceUsd as number).toBeLessThanOrEqual(
        share.shareUsd
      );
    }
  });

  it('a share that buys nothing gets null, never a forced over-budget pick', () => {
    const result = splitGiftBudget(30, [recipient('A')]);
    const picks = suggestPicksForSplit(CANDIDATES, result.shares);
    expect(picks[0].pick).toBeNull();
  });

  it('sample-laptop is never a pick, even at $10', () => {
    const result = splitGiftBudget(10, [recipient('A')]);
    const picks = suggestPicksForSplit(CANDIDATES, result.shares);
    // Only the demo row is $10 — it is excluded, so no pick.
    expect(picks[0].pick).toBeNull();
  });
});

describe('parseGiftSplitParams', () => {
  it('lines up repeated name/weight/interests params by position', () => {
    const parsed = parseGiftSplitParams({
      total: '200',
      name: ['Ayesha', 'Bilal'],
      weight: ['', '2'],
      interests: ['laptop', 'headphones'],
      occasion: 'Birthday',
    });
    expect(parsed.totalUsd).toBe(200);
    expect(parsed.occasion).toBe('Birthday');
    expect(parsed.recipients).toHaveLength(2);
    expect(parsed.recipients[0]).toEqual({ name: 'Ayesha', interests: ['laptop'], weight: null });
    expect(parsed.recipients[1]).toEqual({ name: 'Bilal', interests: ['headphones'], weight: 2 });
    expect(parsed.totalError).toBeNull();
  });

  it('invalid total is reported, not silently defaulted', () => {
    const parsed = parseGiftSplitParams({ total: 'abc', name: 'A' });
    expect(parsed.totalUsd).toBeNull();
    expect(parsed.totalError).toMatch(/not a valid total/);
  });
});
