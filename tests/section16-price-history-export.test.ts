import { describe, expect, it } from 'vitest';
import {
  PRICE_HISTORY_EXPORT_CSV_HEADERS,
  priceHistoryExportFileName,
  priceHistoryRowsToCsv,
  priceHistoryRowsToJson,
} from '@/lib/price-history-export';

/** Real recorded MacBook Air 13 rows (seed factors on base $999). */
const ROWS = [
  { productSlug: 'macbook-air-13', productName: 'MacBook Air 13', price: 1048.95, currency: 'USD', availability: 'in_stock', recordedAt: '2026-10-03T07:13:52Z' },
  { productSlug: 'macbook-air-13', productName: 'MacBook Air 13', price: 1018.98, currency: 'USD', availability: 'in_stock', recordedAt: '2026-10-19T07:13:52Z' },
  { productSlug: 'macbook-air-13', productName: 'MacBook Air 13', price: 999, currency: 'USD', availability: 'in_stock', recordedAt: '2026-10-26T07:13:52Z' },
  { productSlug: 'macbook-air-13', productName: 'MacBook Air 13', price: 999, currency: 'USD', availability: 'in_stock', recordedAt: '2026-11-02T07:13:52Z' },
];

describe('priceHistoryRowsToCsv', () => {
  it('exports the 4 recorded MacBook points, oldest first, with headers', () => {
    const csv = priceHistoryRowsToCsv(ROWS);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(PRICE_HISTORY_EXPORT_CSV_HEADERS);
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('macbook-air-13,MacBook Air 13,1048.95,USD,in_stock,2026-10-03');
    expect(lines[4]).toContain(',999.00,USD,in_stock,2026-11-02');
  });

  it('exports headers only for a product with no recorded history', () => {
    expect(priceHistoryRowsToCsv([])).toBe(`${PRICE_HISTORY_EXPORT_CSV_HEADERS}\n`);
  });

  it('escapes commas and quotes in names instead of breaking the CSV', () => {
    const csv = priceHistoryRowsToCsv([
      { ...ROWS[0], productName: 'Widget, "Pro" model' },
    ]);
    expect(csv).toContain('"Widget, ""Pro"" model"');
  });
});

describe('priceHistoryRowsToJson', () => {
  it('exports the same 4 points as JSON with a point count and an honesty note', () => {
    const json = JSON.parse(
      priceHistoryRowsToJson({ slug: 'macbook-air-13', name: 'MacBook Air 13' }, ROWS)
    );
    expect(json.pointCount).toBe(4);
    expect(json.rows).toHaveLength(4);
    expect(json.rows[0].priceUsd).toBe(1048.95);
    expect(json.rows[3].priceUsd).toBe(999);
    expect(json.note).toContain('Recorded price history only');
  });

  it('says plainly when there is no history', () => {
    const json = JSON.parse(
      priceHistoryRowsToJson({ slug: 'x', name: 'X' }, [])
    );
    expect(json.pointCount).toBe(0);
    expect(json.note).toContain('No recorded price history');
  });
});

describe('priceHistoryExportFileName', () => {
  it('builds safe filenames per format', () => {
    expect(priceHistoryExportFileName('macbook-air-13', 'csv')).toBe(
      'smartbuy-price-history-macbook-air-13.csv'
    );
    expect(priceHistoryExportFileName('macbook-air-13', 'json')).toBe(
      'smartbuy-price-history-macbook-air-13.json'
    );
  });
});
