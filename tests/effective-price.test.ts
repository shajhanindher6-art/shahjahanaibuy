/**
 * Unit tests for the stacked effective price (Section 14, Chunk 2,
 * B6): deal + coupon + cashback into one "you pay" line. Pure math —
 * no database, no network.
 */

import { describe, expect, it } from 'vitest';
import { effectivePrice } from '@/lib/effective-price';

describe('effectivePrice', () => {
  it('stacks deal + percentage coupon + cashback in order', () => {
    // List $1,099, selling $999 (deal $100), SAVE10 (10% off the
    // $999), 5% cashback on the $899.10 paid after coupon.
    const result = effectivePrice({
      price: 999,
      listPrice: 1099,
      coupon: { code: 'SAVE10', discountType: 'percentage', discountValue: 10 },
      cashbackPct: 5,
    });
    expect(result).not.toBeNull();
    expect(result?.listPrice).toBe(1099);
    expect(result?.dealSaving).toBe(100);
    expect(result?.dealPct).toBe(9.1);
    expect(result?.afterDeal).toBe(999);
    expect(result?.couponSaving).toBe(99.9);
    expect(result?.afterCoupon).toBe(899.1);
    expect(result?.cashbackAmount).toBe(44.96);
    expect(result?.youPay).toBe(854.14);
    expect(result?.totalSaving).toBe(244.86);
  });

  it('stacks a fixed-amount coupon ("$15 off")', () => {
    const result = effectivePrice({
      price: 399,
      listPrice: 449,
      coupon: { code: 'BESTBUY15', discountType: 'fixed', discountValue: 15 },
      cashbackPct: 5,
    });
    expect(result?.couponSaving).toBe(15);
    expect(result?.afterCoupon).toBe(384);
    expect(result?.cashbackAmount).toBe(19.2);
    expect(result?.youPay).toBe(364.8);
  });

  it('works with no list price, no coupon, and no cashback', () => {
    const result = effectivePrice({ price: 999 });
    expect(result).not.toBeNull();
    expect(result?.listPrice).toBe(999);
    expect(result?.dealSaving).toBe(0);
    expect(result?.dealPct).toBeNull();
    expect(result?.couponSaving).toBe(0);
    expect(result?.couponApplied).toBeNull();
    expect(result?.cashbackAmount).toBe(0);
    expect(result?.youPay).toBe(999);
    expect(result?.totalSaving).toBe(0);
  });

  it('ignores a compare-at price that is not above the selling price', () => {
    const result = effectivePrice({ price: 999, listPrice: 999 });
    expect(result?.dealSaving).toBe(0);
    expect(result?.dealPct).toBeNull();
    const below = effectivePrice({ price: 999, listPrice: 900 });
    expect(below?.listPrice).toBe(999);
    expect(below?.dealSaving).toBe(0);
  });

  it('floors at $0 — a fixed coupon larger than the price never goes negative', () => {
    const result = effectivePrice({
      price: 10,
      coupon: { code: 'BIG', discountType: 'fixed', discountValue: 50 },
      cashbackPct: 5,
    });
    expect(result?.couponSaving).toBe(10);
    expect(result?.afterCoupon).toBe(0);
    expect(result?.cashbackAmount).toBe(0);
    expect(result?.youPay).toBe(0);
  });

  it('clamps percentage coupons and cashback to 0–100', () => {
    const result = effectivePrice({
      price: 100,
      coupon: { code: 'FREE', discountType: 'percentage', discountValue: 150 },
      cashbackPct: 200,
    });
    expect(result?.couponSaving).toBe(100);
    expect(result?.afterCoupon).toBe(0);
    expect(result?.youPay).toBe(0);
  });

  it('returns null for a missing or invalid selling price', () => {
    expect(effectivePrice({ price: 0 })).toBeNull();
    expect(effectivePrice({ price: -5 })).toBeNull();
    expect(effectivePrice({ price: Number.NaN })).toBeNull();
    expect(effectivePrice({ price: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('rounds every step to cents', () => {
    const result = effectivePrice({
      price: 99.99,
      coupon: { code: 'THIRD', discountType: 'percentage', discountValue: 33 },
      cashbackPct: 5,
    });
    expect(result?.couponSaving).toBe(33);
    expect(result?.afterCoupon).toBe(66.99);
    expect(result?.cashbackAmount).toBe(3.35);
    expect(result?.youPay).toBe(63.64);
  });
});
