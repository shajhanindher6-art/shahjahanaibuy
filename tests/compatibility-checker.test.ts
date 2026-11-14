import { describe, expect, it } from 'vitest';
import {
  checkCompatibility,
  COMPATIBILITY_VERIFY_NOTE,
  parseCompatibilityParams,
  type CompatibilityProductInput,
} from '@/lib/compatibility-checker';
import { gradeCompatibility } from '@/services/compatibility';

function product(
  partial: Partial<CompatibilityProductInput> & { slug: string }
): CompatibilityProductInput {
  return {
    id: partial.slug,
    name: partial.name ?? 'Product',
    brand: partial.brand ?? null,
    category: partial.category ?? null,
    priceUsd: partial.priceUsd ?? 100,
    ...partial,
  };
}

describe('parseCompatibilityParams', () => {
  it('parses a normal ?device=&accessory= pair', () => {
    expect(
      parseCompatibilityParams({ device: 'macbook-air-13', accessory: 'logitech-mx-master-3s' })
    ).toEqual({
      deviceSlug: 'macbook-air-13',
      accessorySlug: 'logitech-mx-master-3s',
      hasQuery: true,
    });
  });

  it('returns nulls when nothing is given (form state, not an error)', () => {
    expect(parseCompatibilityParams({})).toEqual({
      deviceSlug: null,
      accessorySlug: null,
      hasQuery: false,
    });
  });

  it('accepts a device without an accessory and vice versa', () => {
    expect(parseCompatibilityParams({ device: 'macbook-air-13' })).toEqual({
      deviceSlug: 'macbook-air-13',
      accessorySlug: null,
      hasQuery: true,
    });
  });
});

describe('checkCompatibility — grading rules', () => {
  it('grades same brand + same category as Likely, with the verify note', () => {
    const result = checkCompatibility(
      product({ slug: 'macbook-air-13', name: 'MacBook Air 13', brand: 'Apple', category: 'Laptops' }),
      product({ slug: 'apple-mouse', name: 'Apple Mouse', brand: 'Apple', category: 'Laptops' })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check.grade).toBe('Likely');
    expect(result.check.gradeNote).toMatch(/Same brand and category/);
    expect(result.check.gradeNote).toMatch(/verify connector\/specs before buying/);
  });

  it('grades same category only as Possible', () => {
    const result = checkCompatibility(
      product({ slug: 'macbook-air-13', brand: 'Apple', category: 'Laptops' }),
      product({ slug: 'dell-xps-13', brand: 'Dell', category: 'Laptops' })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check.grade).toBe('Possible');
    expect(result.check.gradeNote).toMatch(/Same category/);
  });

  it('grades anything else as Unknown — no compatibility data recorded', () => {
    const result = checkCompatibility(
      product({ slug: 'galaxy-s24-ultra', brand: 'Samsung', category: 'Smartphones' }),
      product({ slug: 'sony-wh-1000xm5', brand: 'Sony', category: 'Headphones' })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check.grade).toBe('Unknown');
    expect(result.check.gradeNote).toMatch(/Compatibility unknown/);
  });

  it('grades null brand/category as Unknown, never a guessed Likely', () => {
    const result = checkCompatibility(
      product({ slug: 'device-a', brand: null, category: null }),
      product({ slug: 'device-b', brand: null, category: null })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check.grade).toBe('Unknown');
  });

  it('never assigns "Exact" — the engine has no compatibility data source', () => {
    // Every combination the grader can produce.
    const pairs: Array<[CompatibilityProductInput, CompatibilityProductInput]> = [
      [
        product({ slug: 'a', brand: 'Apple', category: 'Laptops' }),
        product({ slug: 'b', brand: 'Apple', category: 'Laptops' }),
      ],
      [
        product({ slug: 'a', brand: 'Apple', category: 'Laptops' }),
        product({ slug: 'b', brand: 'Dell', category: 'Laptops' }),
      ],
      [
        product({ slug: 'a', brand: 'Apple', category: 'Laptops' }),
        product({ slug: 'b', brand: 'Sony', category: 'Headphones' }),
      ],
    ];
    for (const [device, accessory] of pairs) {
      const graded = gradeCompatibility(
        { brand: device.brand, category: device.category },
        {
          slug: accessory.slug,
          name: accessory.name,
          brand: accessory.brand,
          category: accessory.category,
          priceUsd: accessory.priceUsd,
        }
      );
      expect(graded.grade).not.toBe('Exact');
      expect(['Likely', 'Possible', 'Unknown']).toContain(graded.grade);
    }
  });

  it('rejects the same product twice instead of grading it Likely', () => {
    const same = product({
      slug: 'macbook-air-13',
      name: 'MacBook Air 13',
      brand: 'Apple',
      category: 'Laptops',
    });
    expect(checkCompatibility(same, same)).toEqual({
      ok: false,
      reason: 'same-product',
    });
  });

  it('always carries the honest connector fallback (no spec field recorded)', () => {
    const result = checkCompatibility(
      product({ slug: 'macbook-air-13', brand: 'Apple', category: 'Laptops' }),
      product({ slug: 'logitech-mx-master-3s', brand: 'Logitech', category: 'Accessories' })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check.connectorNote).toMatch(/Connector info not recorded/);
  });

  it('carries "verify before buying" on every verdict', () => {
    expect(COMPATIBILITY_VERIFY_NOTE).toMatch(/Verify before buying/);
  });
});
