import { describe, expect, it } from 'vitest';
import {
  bestCouponForProduct,
  buildMatrixRows,
  lowestInWindow,
  lowestPrice,
  priceChangeInWindow,
  type MatrixProductInput,
  type PriceHistoryPoint,
} from '@/services/decision-matrix';
import type { DealCoupon } from '@/lib/deal-math';

const NOW = new Date('2026-11-08T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function point(price: number, daysAgo: number): PriceHistoryPoint {
  return { price, recordedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString() };
}

function coupon(partial: Partial<DealCoupon> & { code: string }): DealCoupon {
  return {
    discountType: 'percentage',
    discountValue: 10,
    active: true,
    ...partial,
  };
}

function productInput(
  partial: Partial<MatrixProductInput> & { productId: string }
): MatrixProductInput {
  return {
    slug: 'product',
    name: 'Product',
    brand: null,
    category: null,
    retailers: [],
    coupons: [],
    merchantNameById: {},
    priceHistory: [],
    ...partial,
  };
}

describe('lowestPrice', () => {
  it('takes the minimum retailer price, null when no listings', () => {
    expect(
      lowestPrice([
        { retailerName: 'Amazon', price: 999, rating: null, reviewCount: null, availability: 'in_stock' },
        { retailerName: 'Best Buy', price: 1018.98, rating: null, reviewCount: null, availability: 'in_stock' },
      ])
    ).toBe(999);
    expect(lowestPrice([])).toBeNull();
  });
});

describe('bestCouponForProduct', () => {
  const merchants = { 'm-amazon': 'Amazon', 'm-bestbuy': 'Best Buy' };
  const coupons = [
    coupon({ code: 'SAVE10', merchantId: 'm-amazon', discountValue: 10 }),
    coupon({ code: 'BESTBUY15', merchantId: 'm-bestbuy', discountType: 'fixed', discountValue: 15 }),
    coupon({ code: 'OLD', merchantId: 'm-amazon', validUntil: '2026-01-01' }),
  ];

  it('matches coupons by retailer name and ranks percentage first', () => {
    const best = bestCouponForProduct(['Amazon', 'Best Buy'], coupons, merchants);
    expect(best?.code).toBe('SAVE10');
  });

  it('ignores coupons for merchants the product is not sold by', () => {
    expect(bestCouponForProduct(['eBay'], coupons, merchants)).toBeNull();
  });

  it('never returns an expired coupon', () => {
    const best = bestCouponForProduct(['Amazon'], [coupons[2]], merchants);
    expect(best).toBeNull();
  });
});

describe('priceChangeInWindow', () => {
  it('computes oldest-to-latest change inside 30 days', () => {
    // MacBook seed history: 1048.95 (30d ago) → 999 (today).
    // (999 - 1048.95) / 1048.95 = -4.76% → -4.8 after rounding.
    const change = priceChangeInWindow(
      [point(1048.95, 30), point(1018.98, 14), point(999, 7), point(999, 0)],
      30,
      NOW
    );
    expect(change).toEqual({ changePct: -4.8, from: 1048.95, to: 999 });
  });

  it('returns null with fewer than 2 points in the window', () => {
    expect(priceChangeInWindow([point(999, 0)], 30, NOW)).toBeNull();
    expect(priceChangeInWindow([], 30, NOW)).toBeNull();
    // Points older than the window do not count.
    expect(priceChangeInWindow([point(1000, 60), point(900, 45)], 30, NOW)).toBeNull();
  });

  it('ignores points outside the window', () => {
    // 1000 (60d ago) is outside; inside: 900 (10d) → 800 (today) = -11.1%.
    const change = priceChangeInWindow(
      [point(1000, 60), point(900, 10), point(800, 0)],
      30,
      NOW
    );
    expect(change).toEqual({ changePct: -11.1, from: 900, to: 800 });
  });
});

describe('lowestInWindow', () => {
  it('takes the minimum inside the window only', () => {
    expect(
      lowestInWindow([point(1000, 60), point(900, 10), point(800, 0)], 30, NOW)
    ).toBe(800);
    expect(lowestInWindow([point(1000, 60)], 30, NOW)).toBeNull();
  });
});

describe('buildMatrixRows', () => {
  it('builds honest rows: real values shown, missing data null', () => {
    const rows = buildMatrixRows(
      [
        productInput({
          productId: '1',
          slug: 'macbook-air-13',
          name: 'MacBook Air 13',
          brand: 'Apple',
          category: 'Laptops',
          retailers: [
            { retailerName: 'Amazon', price: 999, rating: 4.5, reviewCount: 120, availability: 'in_stock' },
            { retailerName: 'Best Buy', price: 1018.98, rating: null, reviewCount: null, availability: 'in_stock' },
          ],
          coupons: [coupon({ code: 'SAVE10', merchantId: 'm-amazon' })],
          merchantNameById: { 'm-amazon': 'Amazon' },
          priceHistory: [point(1048.95, 30), point(999, 0)],
        }),
        productInput({
          productId: '2',
          slug: 'dell-xps-13',
          name: 'Dell XPS 13',
          brand: 'Dell',
          category: null, // unknown category → "—"
          retailers: [],
          coupons: [],
          merchantNameById: {},
          priceHistory: [],
        }),
      ],
      NOW
    );

    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    // Lowest price: 999 vs null; cheapest highlighted.
    expect(byKey['lowest-price'].cells).toEqual([
      { kind: 'usd', usd: 999 },
      null,
    ]);
    expect(byKey['lowest-price'].highlight).toEqual([true, false]);
    // Category: real vs missing.
    expect(byKey['category'].cells).toEqual([
      { kind: 'text', text: 'Laptops' },
      null,
    ]);
    // Best coupon: SAVE10 vs none.
    expect(byKey['best-coupon'].cells).toEqual([
      { kind: 'text', text: 'SAVE10 — 10% off' },
      null,
    ]);
    // Price change: -4.8% vs none.
    expect(byKey['price-change-30d'].cells).toEqual([
      { kind: 'text', text: '-4.8%' },
      null,
    ]);
    // Rating / reviews from the first non-null retailer row.
    expect(byKey['rating'].cells).toEqual([{ kind: 'text', text: '4.5 ★' }, null]);
    expect(byKey['reviews'].cells).toEqual([{ kind: 'text', text: '120' }, null]);
    // Availability: in stock vs no retailers.
    expect(byKey['availability'].cells).toEqual([
      { kind: 'text', text: 'In Stock' },
      null,
    ]);
    // Every row has one cell per product.
    for (const row of rows) {
      expect(row.cells).toHaveLength(2);
      expect(row.highlight).toHaveLength(2);
    }
  });
});
