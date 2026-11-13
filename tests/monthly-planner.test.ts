import { describe, expect, it } from 'vitest';
import {
  buildMonthlyPlan,
  currentMonth,
  decidePlanItem,
  isValidMonth,
  priceVsLowNote,
  type PlannerItemInput,
} from '@/lib/monthly-planner';
import { predictBuyVsWait } from '@/services/buy-wait-prediction';

// Sections 21–25, Stage E (E-P2-2): buy-wait verdicts are WITHHELD
// on a stale latest price (> 7 days), so fixtures must end near
// today — the old absolute 2026-09-01 start made every fixture
// stale and every decision 'wait'. Points are 5 days apart, so a
// 5-point fixture spans 20 days ending today.
function points(prices: number[], startIso = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()) {
  const start = Date.parse(startIso);
  return prices.map((price, i) => ({
    price,
    recordedAt: new Date(start + i * 5 * 24 * 60 * 60 * 1000).toISOString(),
  }));
}

const atLow: PlannerItemInput = {
  productSlug: 'laptop-a',
  productName: 'Laptop A',
  currentPrice: 999,
  lowest30dPrice: 999,
  // 5 points: the Section 20 (§12 #46) buy-wait minimum — the
  // old 3-point fixture returned not_enough_data.
  prediction: predictBuyVsWait(points([1099, 1049, 999, 999, 999])),
};

const aboveAverage: PlannerItemInput = {
  productSlug: 'laptop-b',
  productName: 'Laptop B',
  currentPrice: 1200,
  lowest30dPrice: 999,
  prediction: predictBuyVsWait(points([999, 1050, 1100, 1150, 1200])),
};

describe('decidePlanItem', () => {
  it('buys now when Buy vs Wait says buy_now at the 30-day low', () => {
    const item = decidePlanItem(atLow);
    expect(item.decision).toBe('buy_now');
    expect(item.reason).toContain('Buy Now');
    expect(item.reason).toContain('30-day low');
  });

  it('waits when Buy vs Wait says wait above the average', () => {
    const item = decidePlanItem(aboveAverage);
    expect(item.decision).toBe('wait');
    expect(item.reason).toContain('Wait');
  });

  it('moves an unpriced product to next_month with an honest reason', () => {
    const item = decidePlanItem({
      productSlug: 'no-price',
      productName: 'No Price',
      currentPrice: null,
      lowest30dPrice: null,
      prediction: null,
    });
    expect(item.decision).toBe('next_month');
    expect(item.reason).toContain('No recorded price');
  });

  it('waits when there is not enough price history to judge', () => {
    const item = decidePlanItem({
      productSlug: 'one-point',
      productName: 'One Point',
      currentPrice: 500,
      lowest30dPrice: 500,
      prediction: predictBuyVsWait(points([500])),
    });
    expect(item.decision).toBe('wait');
    expect(item.reason).toContain('Not enough recorded price history');
  });
});

describe('priceVsLowNote', () => {
  it('says at the low when current is within 2% of the 30-day low', () => {
    expect(priceVsLowNote(1000, 999)).toContain('at its recorded 30-day low');
  });

  it('reports the percentage above the low otherwise', () => {
    expect(priceVsLowNote(1200, 1000)).toContain('20% above its recorded 30-day low');
  });

  it('is empty when either price is missing', () => {
    expect(priceVsLowNote(null, 1000)).toBe('');
    expect(priceVsLowNote(1000, null)).toBe('');
  });
});

describe('buildMonthlyPlan', () => {
  it('keeps a buy_now item that fits the budget and reports the remainder', () => {
    const plan = buildMonthlyPlan([atLow], 1500);
    expect(plan.items[0].decision).toBe('buy_now');
    expect(plan.buyNowTotalUsd).toBe(999);
    expect(plan.remainingBudgetUsd).toBe(501);
    expect(plan.overBudget).toBe(false);
  });

  it('moves a buy_now item that does not fit to next_month', () => {
    const plan = buildMonthlyPlan([atLow], 500);
    expect(plan.items[0].decision).toBe('next_month');
    expect(plan.items[0].reason).toContain('does not fit');
    expect(plan.buyNowTotalUsd).toBe(0);
    expect(plan.nextMonthTotalUsd).toBe(999);
    expect(plan.remainingBudgetUsd).toBe(500);
  });

  it('fits the cheapest buy_now candidates first', () => {
    const cheap = { ...atLow, productSlug: 'cheap', productName: 'Cheap', currentPrice: 200, lowest30dPrice: 200 };
    const expensive = { ...atLow, productSlug: 'expensive', productName: 'Expensive', currentPrice: 900, lowest30dPrice: 900 };
    const plan = buildMonthlyPlan([expensive, cheap], 500);
    const bySlug = Object.fromEntries(plan.items.map((i) => [i.productSlug, i]));
    expect(bySlug.cheap.decision).toBe('buy_now');
    expect(bySlug.expensive.decision).toBe('next_month');
    expect(plan.buyNowTotalUsd).toBe(200);
    expect(plan.remainingBudgetUsd).toBe(300);
  });

  it('totals wait and next_month items and counts unpriced items as $0', () => {
    const plan = buildMonthlyPlan(
      [
        aboveAverage,
        {
          productSlug: 'no-price',
          productName: 'No Price',
          currentPrice: null,
          lowest30dPrice: null,
          prediction: null,
        },
      ],
      2000
    );
    expect(plan.waitTotalUsd).toBe(1200);
    expect(plan.nextMonthTotalUsd).toBe(0);
  });
});

describe('month helpers', () => {
  it('accepts strict YYYY-MM months only', () => {
    expect(isValidMonth('2026-11')).toBe(true);
    expect(isValidMonth('2026-13')).toBe(false);
    expect(isValidMonth('2026-1')).toBe(false);
    expect(isValidMonth('Nov 2026')).toBe(false);
    expect(isValidMonth(null)).toBe(false);
  });

  it('formats the current month as YYYY-MM', () => {
    expect(currentMonth(new Date(2026, 10, 10))).toBe('2026-11');
  });
});
