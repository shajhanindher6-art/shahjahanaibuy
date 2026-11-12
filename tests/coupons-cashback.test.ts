import { describe, expect, it } from 'vitest';
import type { CashbackOffer, Coupon } from '@/types/catalog';
import {
  DEMO_DATA_NOTE,
  filterCashbackOffers,
  filterCoupons,
  formatCashbackValue,
  formatCouponValue,
  formatExpiry,
  isCashbackOfferExpired,
  parseFinderParams,
} from '@/lib/coupons-cashback';

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'c1',
    code: 'SAVE10',
    merchantId: 'amazon',
    description: '10% off at Amazon',
    discountType: 'percentage',
    discountValue: 10,
    minOrderValue: null,
    maxDiscountAmount: null,
    usageLimit: null,
    usageCount: 0,
    perUserLimit: 1,
    validFrom: '2026-01-01T00:00:00Z',
    validUntil: '2027-01-29T00:00:00Z',
    active: true,
    ...overrides,
  };
}

function cashback(overrides: Partial<CashbackOffer> = {}): CashbackOffer {
  return {
    id: 'cb1',
    merchantId: 'bestbuy',
    productId: 'prod-laptop',
    title: '5% back on laptops',
    description: 'Cashback on laptop purchases',
    cashbackType: 'percentage',
    cashbackValue: 5,
    maxCashbackAmount: 50,
    startAt: '2026-01-01T00:00:00Z',
    endAt: '2027-01-29T00:00:00Z',
    termsUrl: 'https://example.com/terms',
    active: true,
    ...overrides,
  };
}

const NOW = new Date('2026-11-12T00:00:00Z');
const PRODUCT_CATEGORIES = new Map([['prod-laptop', 'Laptops']]);

describe('parseFinderParams', () => {
  it('defaults to all kinds, empty filters', () => {
    expect(parseFinderParams({})).toEqual({
      q: '',
      store: '',
      kind: 'all',
      category: '',
    });
  });

  it('keeps coupons / cashback kinds, falls back to all for unknown kinds', () => {
    expect(parseFinderParams({ kind: 'coupons' }).kind).toBe('coupons');
    expect(parseFinderParams({ kind: 'cashback' }).kind).toBe('cashback');
    expect(parseFinderParams({ kind: 'bogus' }).kind).toBe('all');
  });

  it('trims values and takes the first of a repeated param', () => {
    const params = parseFinderParams({
      q: ['  SAVE10 ', 'other'],
      store: ' amazon ',
    });
    expect(params.q).toBe('SAVE10');
    expect(params.store).toBe('amazon');
  });
});

describe('filterCoupons', () => {
  const coupons = [
    coupon(),
    coupon({
      id: 'c2',
      code: 'BESTBUY15',
      merchantId: 'bestbuy',
      discountType: 'fixed',
      discountValue: 15,
      description: '$15 off at Best Buy',
    }),
  ];

  it('returns all coupons with no filters', () => {
    expect(filterCoupons(coupons, { q: '', merchantId: '' })).toHaveLength(2);
  });

  it('filters by store (merchant id)', () => {
    const result = filterCoupons(coupons, { q: '', merchantId: 'amazon' });
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('SAVE10');
  });

  it('searches code and description, case-insensitively', () => {
    expect(
      filterCoupons(coupons, { q: 'save10', merchantId: '' })
    ).toHaveLength(1);
    expect(
      filterCoupons(coupons, { q: 'best buy', merchantId: '' })
    ).toHaveLength(1);
    expect(
      filterCoupons(coupons, { q: 'no-such-code', merchantId: '' })
    ).toHaveLength(0);
  });
});

describe('filterCashbackOffers + isCashbackOfferExpired', () => {
  const offers = [
    cashback(),
    cashback({
      id: 'cb2',
      merchantId: 'amazon',
      productId: null,
      title: 'Store-wide 2% back',
      cashbackType: 'percentage',
      cashbackValue: 2,
    }),
    cashback({
      id: 'cb3',
      endAt: '2026-01-01T00:00:00Z',
      title: 'Expired offer',
    }),
  ];

  it('excludes expired offers', () => {
    expect(isCashbackOfferExpired(offers[2], NOW)).toBe(true);
    expect(isCashbackOfferExpired(offers[0], NOW)).toBe(false);
    const result = filterCashbackOffers(
      offers,
      { q: '', merchantId: '', category: '', productCategoryById: PRODUCT_CATEGORIES },
      NOW
    );
    expect(result.map((o) => o.id)).toEqual(['cb1', 'cb2']);
  });

  it('filters by store and search text', () => {
    const result = filterCashbackOffers(
      offers,
      { q: 'laptops', merchantId: '', category: '', productCategoryById: PRODUCT_CATEGORIES },
      NOW
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cb1');
  });

  it('category matches the linked product, store-wide offers pass any category', () => {
    const result = filterCashbackOffers(
      offers,
      { q: '', merchantId: '', category: 'Laptops', productCategoryById: PRODUCT_CATEGORIES },
      NOW
    );
    expect(result.map((o) => o.id)).toEqual(['cb1', 'cb2']);

    const other = filterCashbackOffers(
      offers,
      { q: '', merchantId: '', category: 'Phones', productCategoryById: PRODUCT_CATEGORIES },
      NOW
    );
    // Linked laptop offer is out; store-wide offer stays.
    expect(other.map((o) => o.id)).toEqual(['cb2']);
  });
});

describe('value + expiry labels', () => {
  it('formats percentage and fixed coupon values', () => {
    expect(formatCouponValue(coupon())).toBe('10% OFF');
    expect(
      formatCouponValue(coupon({ discountType: 'fixed', discountValue: 15 }))
    ).toBe('$15 OFF');
  });

  it('formats percentage and fixed cashback values', () => {
    expect(formatCashbackValue(cashback())).toBe('5% cashback');
    expect(
      formatCashbackValue(cashback({ cashbackType: 'fixed', cashbackValue: 10 }))
    ).toBe('$10 cashback');
  });

  it('formats expiry as a readable date, or "No expiry shown"', () => {
    expect(formatExpiry('2027-01-29T00:00:00Z')).toBe(
      'Valid until 29 January 2027'
    );
    expect(formatExpiry(null)).toBe('No expiry shown');
    expect(formatExpiry('not-a-date')).toBe('No expiry shown');
  });
});

describe('honesty labelling', () => {
  it('labels the rows as demo / seed data, never live merchant offers', () => {
    expect(DEMO_DATA_NOTE).toMatch(/Demo \/ seed data/);
    expect(DEMO_DATA_NOTE).toMatch(/not live merchant offers/);
    expect(DEMO_DATA_NOTE).not.toMatch(/verified/i);
  });
});
