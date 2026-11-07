import { describe, expect, it } from 'vitest';
import {
  bestCoupon,
  couponValueLabel,
  discountPercent,
  isCouponCurrentlyValid,
  type DealCoupon,
} from '@/lib/deal-math';

const NOW = new Date('2026-11-07T12:00:00Z');

function coupon(partial: Partial<DealCoupon> & { code: string }): DealCoupon {
  return {
    discountType: 'percentage',
    discountValue: 10,
    active: true,
    ...partial,
  };
}

describe('discountPercent (merchant basis)', () => {
  it('computes the saving vs compare-at price, 1 decimal', () => {
    // (1018.98 - 999) / 1018.98 = 1.96% → 2.0 after rounding
    expect(discountPercent(999, 1018.98)).toBe(2.0);
    expect(discountPercent(900, 1000)).toBe(10);
  });

  it('returns null when there is no real saving', () => {
    expect(discountPercent(999, null)).toBeNull();
    expect(discountPercent(999, undefined)).toBeNull();
    expect(discountPercent(999, 999)).toBeNull(); // compare-at == price
    expect(discountPercent(999, 899)).toBeNull(); // compare-at below price
    expect(discountPercent(999, 0)).toBeNull();
  });
});

describe('isCouponCurrentlyValid', () => {
  it('accepts an active coupon inside its window', () => {
    expect(
      isCouponCurrentlyValid(
        coupon({ code: 'SAVE10', validUntil: '2027-01-29' }),
        NOW
      )
    ).toBe(true);
  });

  it('rejects expired, inactive, not-started, and exhausted coupons', () => {
    expect(
      isCouponCurrentlyValid(
        coupon({ code: 'OLD', validUntil: '2026-01-01' }),
        NOW
      )
    ).toBe(false);
    expect(
      isCouponCurrentlyValid(coupon({ code: 'OFF', active: false }), NOW)
    ).toBe(false);
    expect(
      isCouponCurrentlyValid(
        coupon({ code: 'SOON', validFrom: '2027-01-01' }),
        NOW
      )
    ).toBe(false);
    expect(
      isCouponCurrentlyValid(
        coupon({ code: 'USED', usageLimit: 5, usageCount: 5 }),
        NOW
      )
    ).toBe(false);
    expect(
      isCouponCurrentlyValid(
        coupon({ code: 'LEFT', usageLimit: 5, usageCount: 4 }),
        NOW
      )
    ).toBe(true);
  });
});

describe('bestCoupon', () => {
  it('ranks percentage coupons before fixed-amount ones', () => {
    const best = bestCoupon(
      [
        coupon({ code: 'BESTBUY15', discountType: 'fixed', discountValue: 15 }),
        coupon({ code: 'SAVE10', discountType: 'percentage', discountValue: 10 }),
      ],
      NOW
    );
    expect(best?.code).toBe('SAVE10');
  });

  it('never returns an expired or inactive coupon', () => {
    expect(
      bestCoupon(
        [
          coupon({ code: 'OLD', validUntil: '2026-01-01' }),
          coupon({ code: 'OFF', active: false }),
        ],
        NOW
      )
    ).toBeNull();
    expect(bestCoupon([], NOW)).toBeNull();
  });

  it('breaks ties by earliest expiry, then code', () => {
    const best = bestCoupon(
      [
        coupon({ code: 'B', discountValue: 10, validUntil: '2027-06-01' }),
        coupon({ code: 'A', discountValue: 10, validUntil: '2027-01-01' }),
      ],
      NOW
    );
    expect(best?.code).toBe('A');
  });
});

describe('couponValueLabel', () => {
  it('labels percentage and fixed coupons', () => {
    expect(couponValueLabel(coupon({ code: 'X', discountValue: 10 }))).toBe(
      '10% off'
    );
    expect(
      couponValueLabel(
        coupon({ code: 'Y', discountType: 'fixed', discountValue: 15 })
      )
    ).toBe('$15 off');
  });
});
