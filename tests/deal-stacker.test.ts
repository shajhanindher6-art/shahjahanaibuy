/**
 * AI Deal Stacker math — tests for lib/deal-stacker.ts (T8).
 *
 * The honesty rules under test: the drop is never double-counted
 * (base = pre-drop price), expired coupons never stack, cashback
 * applies only to its merchant/product, and a product with nothing
 * applicable gets "no stack", never an invented component.
 */

import { describe, expect, it } from 'vitest';
import type { CashbackOffer } from '@/types/catalog';
import type { DealCoupon } from '@/lib/deal-math';
import {
  bestCashbackForStack,
  buildDealStack,
  cashbackSaving,
  couponSaving,
  isCashbackOfferCurrentlyValid,
  recordedDrop,
  type DealStackInput,
} from '@/lib/deal-stacker';

const NOW = new Date('2026-11-14T12:00:00Z');

function coupon(overrides: Partial<DealCoupon> = {}): DealCoupon {
  return {
    code: 'SAVE10',
    merchantId: 'amazon',
    description: '10% off at Amazon',
    discountType: 'percentage',
    discountValue: 10,
    minOrderValue: null,
    maxDiscountAmount: null,
    usageLimit: null,
    usageCount: 0,
    validFrom: '2026-01-01T00:00:00Z',
    validUntil: '2027-01-29T00:00:00Z',
    active: true,
    ...overrides,
  };
}

function cashback(overrides: Partial<CashbackOffer> = {}): CashbackOffer {
  return {
    id: 'cb1',
    merchantId: 'amazon',
    productId: 'prod-1',
    title: '5% cashback at Amazon',
    description: 'Demo cashback offer.',
    cashbackType: 'percentage',
    cashbackValue: 5,
    maxCashbackAmount: null,
    startAt: '2026-01-01T00:00:00Z',
    endAt: '2027-01-29T00:00:00Z',
    termsUrl: null,
    active: true,
    ...overrides,
  };
}

function input(overrides: Partial<DealStackInput> = {}): DealStackInput {
  return {
    productId: 'prod-1',
    productName: 'MacBook Air 13',
    productSlug: 'macbook-air-13',
    merchantId: 'amazon',
    merchantName: 'Amazon',
    lowestPrice: 999,
    priceRecordedAt: '2026-11-02T00:00:00Z',
    historyPoints: [
      { price: 999, recordedAt: '2026-11-02T00:00:00Z' },
      { price: 1099, recordedAt: '2026-10-26T00:00:00Z' },
    ],
    coupons: [coupon()],
    cashbackOffers: [cashback()],
    now: NOW,
    ...overrides,
  };
}

describe('couponSaving', () => {
  it('takes a percentage off the price', () => {
    expect(couponSaving(coupon(), 999)).toBe(99.9);
  });

  it('caps a percentage coupon at maxDiscountAmount', () => {
    expect(
      couponSaving(coupon({ maxDiscountAmount: 50 }), 999)
    ).toBe(50);
  });

  it('takes a fixed coupon in full, never more than the price', () => {
    expect(
      couponSaving(coupon({ discountType: 'fixed', discountValue: 15 }), 999)
    ).toBe(15);
    expect(
      couponSaving(coupon({ discountType: 'fixed', discountValue: 15 }), 10)
    ).toBe(10);
  });

  it('saves nothing below the minimum order value', () => {
    expect(couponSaving(coupon({ minOrderValue: 1000 }), 999)).toBe(0);
  });
});

describe('cashbackSaving', () => {
  it('takes a percentage of the price', () => {
    expect(cashbackSaving(cashback(), 999)).toBe(49.95);
  });

  it('caps percentage cashback at maxCashbackAmount', () => {
    expect(
      cashbackSaving(cashback({ maxCashbackAmount: 20 }), 999)
    ).toBe(20);
  });

  it('takes fixed cashback in full, never more than the price', () => {
    expect(
      cashbackSaving(
        cashback({ cashbackType: 'fixed', cashbackValue: 10 }),
        999
      )
    ).toBe(10);
  });
});

describe('isCashbackOfferCurrentlyValid', () => {
  it('accepts an active offer inside its window', () => {
    expect(isCashbackOfferCurrentlyValid(cashback(), NOW)).toBe(true);
  });

  it('rejects an expired offer', () => {
    expect(
      isCashbackOfferCurrentlyValid(
        cashback({ endAt: '2026-11-01T00:00:00Z' }),
        NOW
      )
    ).toBe(false);
  });

  it('rejects an offer that has not started yet', () => {
    expect(
      isCashbackOfferCurrentlyValid(
        cashback({ startAt: '2026-12-01T00:00:00Z' }),
        NOW
      )
    ).toBe(false);
  });

  it('rejects an inactive offer', () => {
    expect(
      isCashbackOfferCurrentlyValid(cashback({ active: false }), NOW)
    ).toBe(false);
  });
});

describe('recordedDrop', () => {
  it('finds the fall from the previous point to the latest', () => {
    const drop = recordedDrop([
      { price: 999, recordedAt: '2026-11-02T00:00:00Z' },
      { price: 1099, recordedAt: '2026-10-26T00:00:00Z' },
    ]);
    expect(drop).not.toBeNull();
    expect(drop?.amount).toBe(100);
    expect(drop?.fromPrice).toBe(1099);
    expect(drop?.toPrice).toBe(999);
  });

  it('returns null when the price did not fall', () => {
    expect(
      recordedDrop([
        { price: 999, recordedAt: '2026-11-02T00:00:00Z' },
        { price: 999, recordedAt: '2026-10-26T00:00:00Z' },
      ])
    ).toBeNull();
    expect(
      recordedDrop([
        { price: 1099, recordedAt: '2026-11-02T00:00:00Z' },
        { price: 999, recordedAt: '2026-10-26T00:00:00Z' },
      ])
    ).toBeNull();
  });

  it('returns null with fewer than two points', () => {
    expect(
      recordedDrop([{ price: 999, recordedAt: '2026-11-02T00:00:00Z' }])
    ).toBeNull();
    expect(recordedDrop([])).toBeNull();
  });

  it('does not rely on input order', () => {
    const drop = recordedDrop([
      { price: 1099, recordedAt: '2026-10-26T00:00:00Z' },
      { price: 999, recordedAt: '2026-11-02T00:00:00Z' },
    ]);
    expect(drop?.amount).toBe(100);
  });
});

describe('bestCashbackForStack', () => {
  it('picks the largest saving for this merchant and product', () => {
    const best = bestCashbackForStack(
      [
        cashback({ id: 'cb-small', cashbackValue: 2 }),
        cashback({ id: 'cb-big', cashbackValue: 5 }),
      ],
      'amazon',
      'prod-1',
      999,
      NOW
    );
    expect(best?.offer.id).toBe('cb-big');
    expect(best?.saving).toBe(49.95);
  });

  it('accepts a store-wide offer (no product link)', () => {
    const best = bestCashbackForStack(
      [cashback({ productId: null })],
      'amazon',
      'prod-1',
      999,
      NOW
    );
    expect(best?.offer.id).toBe('cb1');
  });

  it('ignores offers for another merchant or another product', () => {
    expect(
      bestCashbackForStack(
        [cashback({ merchantId: 'bestbuy' })],
        'amazon',
        'prod-1',
        999,
        NOW
      )
    ).toBeNull();
    expect(
      bestCashbackForStack(
        [cashback({ productId: 'prod-2' })],
        'amazon',
        'prod-1',
        999,
        NOW
      )
    ).toBeNull();
  });

  it('ignores expired offers', () => {
    expect(
      bestCashbackForStack(
        [cashback({ endAt: '2026-11-01T00:00:00Z' })],
        'amazon',
        'prod-1',
        999,
        NOW
      )
    ).toBeNull();
  });
});

describe('buildDealStack', () => {
  it('stacks drop + coupon + cashback without double-counting the drop', () => {
    // Previous $1,099 → latest $999 (drop $100) → SAVE10 $99.90 →
    // 5% cashback $49.95. Total saving $249.85 off the $1,099 base.
    const stack = buildDealStack(input());
    expect(stack.hasStack).toBe(true);
    expect(stack.basePrice).toBe(1099);
    expect(stack.currentPrice).toBe(999);
    expect(stack.components.map((c) => c.kind)).toEqual([
      'price-drop',
      'coupon',
      'cashback',
    ]);
    expect(stack.components.map((c) => c.amount)).toEqual([100, 99.9, 49.95]);
    expect(stack.totalSaving).toBe(249.85);
    expect(stack.stackedTotal).toBe(849.15);
  });

  it('labels the recorded price stale (12 days old at the test date)', () => {
    const stack = buildDealStack(input());
    expect(stack.priceAgeDays).toBe(12);
    expect(stack.priceStale).toBe(true);
  });

  it('stacks coupon + cashback with no drop when the price never fell', () => {
    const stack = buildDealStack(
      input({
        historyPoints: [
          { price: 999, recordedAt: '2026-11-02T00:00:00Z' },
          { price: 999, recordedAt: '2026-10-26T00:00:00Z' },
        ],
      })
    );
    expect(stack.hasStack).toBe(true);
    expect(stack.basePrice).toBe(999);
    expect(stack.components.map((c) => c.kind)).toEqual([
      'coupon',
      'cashback',
    ]);
    expect(stack.totalSaving).toBe(149.85);
    expect(stack.stackedTotal).toBe(849.15);
  });

  it('never stacks an expired coupon', () => {
    const stack = buildDealStack(
      input({
        coupons: [coupon({ validUntil: '2026-11-01T00:00:00Z' })],
        historyPoints: [
          { price: 999, recordedAt: '2026-11-02T00:00:00Z' },
        ],
        cashbackOffers: [],
      })
    );
    expect(stack.hasStack).toBe(false);
    expect(stack.noStackReason).toMatch(/Nothing stacks/);
  });

  it('never stacks a coupon for another store', () => {
    const stack = buildDealStack(
      input({
        coupons: [coupon({ merchantId: 'bestbuy' })],
        historyPoints: [
          { price: 999, recordedAt: '2026-11-02T00:00:00Z' },
        ],
        cashbackOffers: [],
      })
    );
    expect(stack.hasStack).toBe(false);
  });

  it('reports no stack when there is no in-stock recorded listing', () => {
    const stack = buildDealStack(
      input({ lowestPrice: null, merchantId: null, merchantName: null })
    );
    expect(stack.hasStack).toBe(false);
    expect(stack.totalSaving).toBeNull();
    expect(stack.stackedTotal).toBeNull();
    expect(stack.noStackReason).toMatch(/No in-stock recorded listing/);
  });

  it('each component names its source', () => {
    const stack = buildDealStack(input());
    expect(stack.components[0].source).toBe('Recorded price history');
    expect(stack.components[1].source).toContain('Coupons table');
    expect(stack.components[2].source).toContain('Cashback offer');
  });
});
