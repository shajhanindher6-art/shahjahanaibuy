import { describe, expect, it } from 'vitest';
import {
  buildComparisonBadges,
  parseLeadingNumber,
  type SummaryBadgeProductInput,
} from '@/services/comparison-summary';
import type { ProductAttribute } from '@/types/catalog';

function attr(
  partial: Partial<ProductAttribute> & { key: string; value: string }
): ProductAttribute {
  return {
    id: `a-${partial.key}-${partial.value}`,
    productId: 'p1',
    unit: null,
    group: null,
    sortOrder: 0,
    ...partial,
  };
}

function product(
  partial: Partial<SummaryBadgeProductInput> & { productId: string }
): SummaryBadgeProductInput {
  return { name: 'Product', lowestPriceUsd: null, attributes: [], ...partial };
}

describe('parseLeadingNumber', () => {
  it('parses "16 GB" → 16 with trailing unit "gb"', () => {
    expect(parseLeadingNumber('16 GB')).toEqual({ num: 16, trailingUnit: 'gb' });
  });

  it('parses decimals and comma-grouped numbers', () => {
    expect(parseLeadingNumber('2.5 GHz')).toEqual({ num: 2.5, trailingUnit: 'ghz' });
    expect(parseLeadingNumber('1,000 mAh')).toEqual({ num: 1000, trailingUnit: 'mah' });
  });

  it('returns null for values with no leading number', () => {
    expect(parseLeadingNumber('Large')).toBeNull();
    expect(parseLeadingNumber('')).toBeNull();
    expect(parseLeadingNumber(null)).toBeNull();
  });
});

describe('buildComparisonBadges', () => {
  it('awards Best for Battery Life to the unique battery max', () => {
    const badges = buildComparisonBadges([
      product({
        productId: 'p1',
        name: 'Laptop A',
        lowestPriceUsd: 999,
        attributes: [attr({ key: 'Battery', value: '100', unit: 'Wh' })],
      }),
      product({
        productId: 'p2',
        name: 'Laptop B',
        lowestPriceUsd: 999,
        attributes: [attr({ key: 'Battery', value: '66', unit: 'Wh' })],
      }),
    ]);
    const battery = badges.find((b) => b.kind === 'battery');
    expect(battery).toMatchObject({
      productId: 'p1',
      productName: 'Laptop A',
      label: 'Best for Battery Life',
      detail: '100 Wh',
    });
  });

  it('awards no battery badge on a tie', () => {
    const badges = buildComparisonBadges([
      product({
        productId: 'p1',
        name: 'Laptop A',
        attributes: [attr({ key: 'Battery', value: '100', unit: 'Wh' })],
      }),
      product({
        productId: 'p2',
        name: 'Laptop B',
        attributes: [attr({ key: 'Battery', value: '100', unit: 'Wh' })],
      }),
    ]);
    expect(badges.find((b) => b.kind === 'battery')).toBeUndefined();
  });

  it('awards no battery badge when fewer than two products have a parseable battery', () => {
    const badges = buildComparisonBadges([
      product({
        productId: 'p1',
        name: 'Laptop A',
        attributes: [attr({ key: 'Battery', value: '100', unit: 'Wh' })],
      }),
      product({ productId: 'p2', name: 'Laptop B', attributes: [] }),
    ]);
    expect(badges.find((b) => b.kind === 'battery')).toBeUndefined();
  });

  it('awards no battery badge for unparseable battery values', () => {
    const badges = buildComparisonBadges([
      product({
        productId: 'p1',
        name: 'Laptop A',
        attributes: [attr({ key: 'Battery', value: 'Large', unit: 'Wh' })],
      }),
      product({
        productId: 'p2',
        name: 'Laptop B',
        attributes: [attr({ key: 'Battery', value: 'Huge', unit: 'Wh' })],
      }),
    ]);
    expect(badges.find((b) => b.kind === 'battery')).toBeUndefined();
  });

  it('awards no battery badge when battery units differ (Wh vs mAh are never compared)', () => {
    const badges = buildComparisonBadges([
      product({
        productId: 'p1',
        name: 'Laptop A',
        attributes: [attr({ key: 'Battery', value: '100', unit: 'Wh' })],
      }),
      product({
        productId: 'p2',
        name: 'Laptop B',
        attributes: [attr({ key: 'Battery', value: '5000', unit: 'mAh' })],
      }),
    ]);
    expect(badges.find((b) => b.kind === 'battery')).toBeUndefined();
  });

  it('awards Best for Multitasking to the unique RAM max', () => {
    const badges = buildComparisonBadges([
      product({
        productId: 'p1',
        name: 'Laptop A',
        attributes: [attr({ key: 'RAM', value: '32', unit: 'GB' })],
      }),
      product({
        productId: 'p2',
        name: 'Laptop B',
        attributes: [attr({ key: 'RAM', value: '16', unit: 'GB' })],
      }),
    ]);
    expect(badges.find((b) => b.kind === 'multitasking')).toMatchObject({
      productId: 'p1',
      label: 'Best for Multitasking',
      detail: '32 GB',
    });
  });

  it('awards no RAM badge on a tie', () => {
    const badges = buildComparisonBadges([
      product({
        productId: 'p1',
        name: 'Laptop A',
        attributes: [attr({ key: 'RAM', value: '16', unit: 'GB' })],
      }),
      product({
        productId: 'p2',
        name: 'Laptop B',
        attributes: [attr({ key: 'RAM', value: '16', unit: 'GB' })],
      }),
    ]);
    expect(badges.find((b) => b.kind === 'multitasking')).toBeUndefined();
  });

  it('awards Best Value for Money to the unique lowest price', () => {
    const badges = buildComparisonBadges([
      product({ productId: 'p1', name: 'Laptop A', lowestPriceUsd: 999 }),
      product({ productId: 'p2', name: 'Laptop B', lowestPriceUsd: 1299 }),
    ]);
    expect(badges.find((b) => b.kind === 'value')).toMatchObject({
      productId: 'p1',
      label: 'Best Value for Money',
      priceUsd: 999,
    });
  });

  it('awards no value badge on a price tie', () => {
    const badges = buildComparisonBadges([
      product({ productId: 'p1', name: 'Laptop A', lowestPriceUsd: 999 }),
      product({ productId: 'p2', name: 'Laptop B', lowestPriceUsd: 999 }),
    ]);
    expect(badges.find((b) => b.kind === 'value')).toBeUndefined();
  });

  it('awards no value badge when fewer than two products have a price', () => {
    const badges = buildComparisonBadges([
      product({ productId: 'p1', name: 'Laptop A', lowestPriceUsd: 999 }),
      product({ productId: 'p2', name: 'Laptop B', lowestPriceUsd: null }),
    ]);
    expect(badges.find((b) => b.kind === 'value')).toBeUndefined();
  });

  it('awards all three badges together when each rule has a unique winner', () => {
    const badges = buildComparisonBadges([
      product({
        productId: 'p1',
        name: 'Laptop A',
        lowestPriceUsd: 899,
        attributes: [
          attr({ key: 'Battery', value: '70', unit: 'Wh' }),
          attr({ key: 'RAM', value: '16', unit: 'GB' }),
        ],
      }),
      product({
        productId: 'p2',
        name: 'Laptop B',
        lowestPriceUsd: 1199,
        attributes: [
          attr({ key: 'Battery', value: '100', unit: 'Wh' }),
          attr({ key: 'RAM', value: '32', unit: 'GB' }),
        ],
      }),
    ]);
    expect(badges.map((b) => b.kind)).toEqual(['battery', 'value', 'multitasking']);
    expect(badges.find((b) => b.kind === 'battery')?.productId).toBe('p2');
    expect(badges.find((b) => b.kind === 'value')?.productId).toBe('p1');
    expect(badges.find((b) => b.kind === 'multitasking')?.productId).toBe('p2');
  });

  it('returns [] for empty or single-product input', () => {
    expect(buildComparisonBadges([])).toEqual([]);
    expect(
      buildComparisonBadges([
        product({
          productId: 'p1',
          name: 'Laptop A',
          lowestPriceUsd: 999,
          attributes: [attr({ key: 'Battery', value: '100', unit: 'Wh' })],
        }),
      ])
    ).toEqual([]);
  });
});
