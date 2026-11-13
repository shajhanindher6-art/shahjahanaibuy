/**
 * Final 100%, F-P2-52 — CSV provider per-row rejection reasons.
 *
 * The provider used to silently drop invalid rows at two levels:
 * `parseCsv` skipped short rows entirely, and `mapCsvRow` returned
 * bare `null` for a missing name — with no reason anywhere. Now
 * every dropped row comes back with a reason via
 * `mapCsvRowWithReason` / `CsvProvider.getLastLoadRejections()`,
 * and an unparseable price is a rejection (not a silently stored $0).
 */
import { describe, expect, it } from 'vitest';
import { CsvProvider, mapCsvRowWithReason } from '@/services/providers/csv-provider';

describe('mapCsvRowWithReason (F-P2-52)', () => {
  it('maps a valid row to a product with no reason', () => {
    const { product, reason } = mapCsvRowWithReason(
      { name: 'Test Laptop', price: '999', brand: 'Acme' },
      'unknown',
      2
    );
    expect(reason).toBeNull();
    expect(product?.name).toBe('Test Laptop');
    expect(product?.price).toBe(999);
  });

  it('rejects a row with no name, with a reason naming the missing field', () => {
    const { product, reason } = mapCsvRowWithReason({ price: '999' }, 'unknown', 3);
    expect(product).toBeNull();
    expect(reason).toMatch(/missing name/);
  });

  it('rejects an unparseable price instead of storing $0', () => {
    const { product, reason } = mapCsvRowWithReason(
      { name: 'Widget', price: 'not-a-price' },
      'unknown',
      4
    );
    expect(product).toBeNull();
    expect(reason).toMatch(/invalid price/);
    expect(reason).toContain('not-a-price');
  });

  it('rejects a negative price', () => {
    const { product, reason } = mapCsvRowWithReason(
      { name: 'Widget', price: '-5' },
      'unknown',
      5
    );
    expect(product).toBeNull();
    expect(reason).toMatch(/invalid price/);
  });

  it('keeps a missing price as 0 (price is optional in a CSV feed)', () => {
    const { product, reason } = mapCsvRowWithReason({ name: 'Widget' }, 'unknown', 6);
    expect(reason).toBeNull();
    expect(product?.price).toBe(0);
  });
});

describe('CsvProvider.getLastLoadRejections (F-P2-52)', () => {
  it('surfaces rejections with row numbers after a load', async () => {
    const csv = [
      'name,price,brand',
      'Good Laptop,999,Acme',
      ',499,Acme',
      'Bad Price Widget,abc,Acme',
      ',499',
    ].join('\n');
    const provider = new CsvProvider({ csv });
    const products = await provider.search({ query: '', limit: 10 });
    expect(products).toHaveLength(1);
    expect(products[0]?.name).toBe('Good Laptop');
    const rejected = provider.getLastLoadRejections();
    // Row 3: missing name. Row 4: invalid price. Row 5: short row
    // (fewer columns than the header, empty name — previously
    // vanished silently in parseCsv).
    expect(rejected).toHaveLength(3);
    expect(rejected.map((r) => r.rowNumber)).toEqual([3, 4, 5]);
    expect(rejected[0].reason).toMatch(/missing name/);
    expect(rejected[1].reason).toMatch(/invalid price/);
    expect(rejected[2].reason).toMatch(/missing name/);
  });

  it('is empty when nothing is rejected', async () => {
    const provider = new CsvProvider({ csv: 'name,price\nOnly Product,10' });
    await provider.search({ query: '', limit: 10 });
    expect(provider.getLastLoadRejections()).toEqual([]);
  });
});
