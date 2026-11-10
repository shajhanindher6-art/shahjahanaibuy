import { describe, expect, it } from 'vitest';
import {
  normalizeQuantity,
  totalQuantity,
  quantityShare,
  productCostSplit,
  shippingShareForMember,
  poolQuantityProgress,
  poolQuantityProgressText,
} from '@/lib/pool-quantities';
import { splitShippingEstimate } from '@/services/smartpool';

describe('normalizeQuantity', () => {
  it('counts unknown or invalid quantities as 1 unit', () => {
    expect(normalizeQuantity(undefined)).toBe(1);
    expect(normalizeQuantity(null)).toBe(1);
    expect(normalizeQuantity(NaN)).toBe(1);
    expect(normalizeQuantity('x')).toBe(1);
    expect(normalizeQuantity(0)).toBe(1);
    expect(normalizeQuantity(-3)).toBe(1);
  });

  it('floors positive quantities to whole units', () => {
    expect(normalizeQuantity(1)).toBe(1);
    expect(normalizeQuantity(2.9)).toBe(2);
    expect(normalizeQuantity(10)).toBe(10);
  });
});

describe('totalQuantity', () => {
  it('sums member quantities, counting missing rows as 1', () => {
    expect(totalQuantity([2, 3])).toBe(5);
    expect(totalQuantity([2, null, undefined, 3])).toBe(7);
    expect(totalQuantity([])).toBe(0);
  });
});

describe('quantityShare', () => {
  it('is the member qty over the pool total', () => {
    expect(quantityShare(2, 10)).toBe(0.2);
    expect(quantityShare(10, 10)).toBe(1);
    expect(quantityShare(1, 4)).toBe(0.25);
  });

  it('is 0 when there is no committed quantity', () => {
    expect(quantityShare(2, 0)).toBe(0);
    expect(quantityShare(2, -5)).toBe(0);
  });
});

describe('productCostSplit', () => {
  it('derives cost live from the recorded unit price x qty', () => {
    expect(productCostSplit(999, 1)).toBe(999);
    expect(productCostSplit(999, 2)).toBe(1998);
    expect(productCostSplit(19.99, 3)).toBe(59.97);
  });

  it('never invents a price when none is recorded', () => {
    expect(productCostSplit(null, 2)).toBeNull();
    expect(productCostSplit(undefined, 2)).toBeNull();
    expect(productCostSplit(0, 2)).toBeNull();
    expect(productCostSplit(-5, 2)).toBeNull();
  });
});

describe('shippingShareForMember', () => {
  it('splits the estimate by quantity share', () => {
    expect(shippingShareForMember(100, 2, 10)).toBe(20);
    expect(shippingShareForMember(100, 1, 4)).toBe(25);
  });

  it('returns null without a valid estimate', () => {
    expect(shippingShareForMember(null, 2, 10)).toBeNull();
    expect(shippingShareForMember(0, 2, 10)).toBeNull();
    expect(shippingShareForMember(100, 2, 0)).toBeNull();
  });
});

describe('poolQuantityProgress', () => {
  it('reports units progress toward the target quantity', () => {
    const p = poolQuantityProgress(3, [2, 2, 3], 10, 20);
    expect(p.members).toBe(3);
    expect(p.totalQuantity).toBe(7);
    expect(p.targetQuantity).toBe(20);
    expect(p.quantityPercent).toBe(35);
    expect(p.quantityReached).toBe(false);
  });

  it('caps percent at 100 and marks the target reached', () => {
    const p = poolQuantityProgress(5, [5, 5, 5, 5, 5], 5, 20);
    expect(p.quantityPercent).toBe(100);
    expect(p.quantityReached).toBe(true);
  });

  it('has no target when none was set (below 2 is not a target)', () => {
    const p = poolQuantityProgress(2, [1, 1], 5, null);
    expect(p.targetQuantity).toBeNull();
    expect(p.quantityPercent).toBeNull();
    expect(p.quantityReached).toBe(false);
    expect(poolQuantityProgress(2, [1, 1], 5, 1).targetQuantity).toBeNull();
  });
});

describe('poolQuantityProgressText', () => {
  it('reads "N of M members · Q of T units committed" with a target', () => {
    expect(poolQuantityProgressText(3, [2, 2, 3], 10, 20)).toBe(
      '3 of 10 members · 7 of 20 units committed'
    );
  });

  it('omits the target when none was set', () => {
    expect(poolQuantityProgressText(3, [1, 1, 1], 10, null)).toBe(
      '3 of 10 members · 3 units committed'
    );
  });
});

describe('splitShippingEstimate (quantity-aware)', () => {
  it('splits evenly as before when no quantities are given', () => {
    const split = splitShippingEstimate(100, 4);
    expect(split?.byQuantity).toBe(false);
    expect(split?.perMemberUsd).toBe(25);
    expect(split?.totalQuantity).toBeNull();
    expect(split?.sharesUsd).toBeNull();
  });

  it('splits by quantity share when quantities exist', () => {
    const split = splitShippingEstimate(100, 3, [1, 1, 2]);
    expect(split?.byQuantity).toBe(true);
    expect(split?.totalQuantity).toBe(4);
    expect(split?.sharesUsd).toEqual([25, 25, 50]);
    // The average share is unchanged by quantities.
    expect(split?.perMemberUsd).toBe(33.33);
  });

  it('shares always sum exactly to the total (no penny drift)', () => {
    const split = splitShippingEstimate(100, 3, [1, 1, 1]);
    expect(split?.sharesUsd?.reduce((s, v) => s + v, 0)).toBe(100);
    const odd = splitShippingEstimate(10, 3, [1, 2, 3]);
    expect(odd?.sharesUsd?.reduce((s, v) => Math.round((s + v) * 100) / 100, 0)).toBe(10);
  });

  it('counts an unknown quantity as 1 unit', () => {
    const split = splitShippingEstimate(90, 3, [2, null, 1]);
    expect(split?.totalQuantity).toBe(4);
    expect(split?.sharesUsd).toEqual([45, 22.5, 22.5]);
  });

  it('still returns null for a missing estimate', () => {
    expect(splitShippingEstimate(null, 3, [1, 1, 1])).toBeNull();
    expect(splitShippingEstimate(0, 3, [1, 1, 1])).toBeNull();
    expect(splitShippingEstimate(100, 0, [])).toBeNull();
  });
});
