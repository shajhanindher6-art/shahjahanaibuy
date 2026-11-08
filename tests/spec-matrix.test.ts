import { describe, expect, it } from 'vitest';
import { buildSpecMatrix, type SpecMatrixProductInput } from '@/services/spec-matrix';
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
  partial: Partial<SpecMatrixProductInput> & { productId: string }
): SpecMatrixProductInput {
  return { name: 'Product', attributes: [], ...partial };
}

describe('buildSpecMatrix', () => {
  it('builds the union of keys in first-seen order', () => {
    const rows = buildSpecMatrix([
      product({
        productId: 'p1',
        attributes: [
          attr({ key: 'RAM', value: '16', unit: 'GB' }),
          attr({ key: 'Storage', value: '512', unit: 'GB' }),
        ],
      }),
      product({
        productId: 'p2',
        attributes: [
          attr({ key: 'Battery', value: '100', unit: 'Wh' }),
          attr({ key: 'RAM', value: '8', unit: 'GB' }),
        ],
      }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['RAM', 'Storage', 'Battery']);
    expect(rows[0].cells).toEqual(['16 GB', '8 GB']);
    expect(rows[1].cells).toEqual(['512 GB', null]);
    expect(rows[2].cells).toEqual([null, '100 Wh']);
  });

  it('renders a missing key as null (component shows "—"), never inventing a value', () => {
    const rows = buildSpecMatrix([
      product({ productId: 'p1', attributes: [attr({ key: 'RAM', value: '16', unit: 'GB' })] }),
      product({ productId: 'p2', attributes: [] }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toEqual(['16 GB', null]);
  });

  it('shows values verbatim with their stored unit', () => {
    const rows = buildSpecMatrix([
      product({
        productId: 'p1',
        attributes: [attr({ key: 'Weight', value: '1.24', unit: 'kg' })],
      }),
      product({
        productId: 'p2',
        attributes: [attr({ key: 'Weight', value: '1.5', unit: 'kg' })],
      }),
    ]);
    expect(rows[0].cells).toEqual(['1.24 kg', '1.5 kg']);
  });

  it('returns [] when no product has any attributes (honest empty state)', () => {
    expect(
      buildSpecMatrix([
        product({ productId: 'p1', attributes: [] }),
        product({ productId: 'p2', attributes: [] }),
      ])
    ).toEqual([]);
    expect(buildSpecMatrix([])).toEqual([]);
  });

  it('treats an empty value as missing', () => {
    const rows = buildSpecMatrix([
      product({
        productId: 'p1',
        attributes: [attr({ key: 'RAM', value: '16', unit: 'GB' })],
      }),
      product({
        productId: 'p2',
        attributes: [attr({ key: 'RAM', value: '', unit: 'GB' })],
      }),
    ]);
    expect(rows[0].cells).toEqual(['16 GB', null]);
  });

  it('takes the first row when a product duplicates a key+unit', () => {
    const rows = buildSpecMatrix([
      product({
        productId: 'p1',
        attributes: [
          attr({ key: 'RAM', value: '16', unit: 'GB' }),
          attr({ key: 'RAM', value: '32', unit: 'GB' }),
        ],
      }),
      product({
        productId: 'p2',
        attributes: [attr({ key: 'RAM', value: '8', unit: 'GB' })],
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toEqual(['16 GB', '8 GB']);
  });

  it('keeps the same key with different units as separate, labelled rows', () => {
    const rows = buildSpecMatrix([
      product({
        productId: 'p1',
        attributes: [attr({ key: 'RAM', value: '16', unit: 'GB' })],
      }),
      product({
        productId: 'p2',
        attributes: [attr({ key: 'RAM', value: '16384', unit: 'MB' })],
      }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['RAM (GB)', 'RAM (MB)']);
    expect(rows[0].cells).toEqual(['16 GB', null]);
    expect(rows[1].cells).toEqual([null, '16384 MB']);
  });

  it('skips attributes with a blank key', () => {
    const rows = buildSpecMatrix([
      product({
        productId: 'p1',
        attributes: [
          attr({ key: '', value: '16', unit: 'GB' }),
          attr({ key: 'RAM', value: '16', unit: 'GB' }),
        ],
      }),
      product({
        productId: 'p2',
        attributes: [attr({ key: 'RAM', value: '8', unit: 'GB' })],
      }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['RAM']);
  });
});
