import { describe, expect, it } from 'vitest';
import {
  groupAttributes,
  formatAttributeValue,
  type AttributeGroup,
} from '@/lib/product-attributes';
import type { ProductAttribute } from '@/types/catalog';

// Seeded-style rows: key/value/unit/group/sort_order exactly as the
// product_attributes table stores them. Expected outputs below are
// hand-computed from these rows only — nothing is invented here.
function attr(
  overrides: Partial<ProductAttribute> & { key: string; value: string }
): ProductAttribute {
  return {
    id: `attr-${overrides.key}-${overrides.value}`,
    productId: 'product-1',
    unit: null,
    group: null,
    sortOrder: 0,
    ...overrides,
  };
}

describe('formatAttributeValue', () => {
  it('returns the value verbatim when there is no unit', () => {
    expect(formatAttributeValue(attr({ key: 'RAM', value: '16' }))).toBe('16');
  });

  it('appends the stored unit with a space', () => {
    expect(
      formatAttributeValue(attr({ key: 'RAM', value: '16', unit: 'GB' }))
    ).toBe('16 GB');
    expect(
      formatAttributeValue(
        attr({ key: 'Battery', value: '100', unit: 'Wh' })
      )
    ).toBe('100 Wh');
  });

  it('returns empty string for an empty value (never a placeholder)', () => {
    expect(formatAttributeValue(attr({ key: 'RAM', value: '' }))).toBe('');
    expect(
      formatAttributeValue(attr({ key: 'RAM', value: '', unit: 'GB' }))
    ).toBe('');
  });
});

describe('groupAttributes', () => {
  it('returns [] for null, undefined, and empty input', () => {
    expect(groupAttributes(null)).toEqual([]);
    expect(groupAttributes(undefined)).toEqual([]);
    expect(groupAttributes([])).toEqual([]);
  });

  it('collects ungrouped rows under group null, in input order', () => {
    const rows = [
      attr({ key: 'RAM', value: '16', unit: 'GB', sortOrder: 1 }),
      attr({ key: 'Storage', value: '512', unit: 'GB', sortOrder: 2 }),
    ];
    expect(groupAttributes(rows)).toEqual([
      { group: null, items: rows },
    ]);
  });

  it('groups by stored group in first-seen order, keeping sort_order within a group', () => {
    const memory = [
      attr({ key: 'RAM', value: '16', unit: 'GB', group: 'Memory', sortOrder: 1 }),
      attr({ key: 'Storage', value: '512', unit: 'GB', group: 'Storage', sortOrder: 2 }),
      attr({ key: 'Memory Type', value: 'LPDDR5', group: 'Memory', sortOrder: 3 }),
    ];
    const groups = groupAttributes(memory);
    expect(groups.map((g: AttributeGroup) => g.group)).toEqual([
      'Memory',
      'Storage',
    ]);
    expect(groups[0].items.map((a) => a.key)).toEqual([
      'RAM',
      'Memory Type',
    ]);
    expect(groups[1].items.map((a) => a.key)).toEqual(['Storage']);
  });

  it('treats an empty-string group as ungrouped', () => {
    const rows = [
      attr({ key: 'RAM', value: '16', unit: 'GB', group: '' }),
      attr({ key: 'Display', value: '13.6', unit: 'inch', group: 'Display' }),
    ];
    const groups = groupAttributes(rows);
    expect(groups.map((g: AttributeGroup) => g.group)).toEqual([
      null,
      'Display',
    ]);
  });

  it('does not mutate the input array', () => {
    const rows = [
      attr({ key: 'RAM', value: '16', unit: 'GB', group: 'Memory' }),
      attr({ key: 'Storage', value: '512', unit: 'GB', group: 'Storage' }),
    ];
    const snapshot = [...rows];
    groupAttributes(rows);
    expect(rows).toEqual(snapshot);
  });
});
