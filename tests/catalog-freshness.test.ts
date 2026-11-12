import { describe, expect, it } from 'vitest';
import { buildFreshnessRow, summarizeFreshness } from '@/lib/catalog-freshness';

const NOW = new Date('2026-11-12T12:00:00.000Z');

const PRODUCT = {
  id: 'p1',
  name: 'MacBook Air M2',
  slug: 'macbook-air-m2',
  brand: 'Apple',
  category: 'Laptops',
  imageUrl: null,
  gtin: null,
  dataFreshness: '2026-11-02T00:00:00.000Z',
};

const POINTS = [
  { recordedAt: '2026-10-03T00:00:00.000Z' },
  { recordedAt: '2026-10-13T00:00:00.000Z' },
  { recordedAt: '2026-10-23T00:00:00.000Z' },
  { recordedAt: '2026-11-02T00:00:00.000Z' },
];

describe('buildFreshnessRow', () => {
  it('shapes a real recorded row: last date, 10-day age, stale badge, missing image/GTIN', () => {
    const row = buildFreshnessRow(PRODUCT, POINTS, NOW);
    expect(row.lastRecordedAt).toBe('2026-11-02T00:00:00.000Z');
    expect(row.lastRecordedLabel).toBe('Nov 2, 2026');
    // 2026-11-02 → 2026-11-12 is 10 whole days (> 7-day stale threshold).
    expect(row.ageDays).toBe(10);
    expect(row.stale).toBe(true);
    expect(row.pointCount).toBe(4);
    expect(row.missingImage).toBe(true);
    expect(row.missingGtin).toBe(true);
    expect(row.dataFreshness).toBe('2026-11-02T00:00:00.000Z');
  });

  it('a fresh price is not stale', () => {
    const row = buildFreshnessRow(PRODUCT, [{ recordedAt: '2026-11-10T00:00:00.000Z' }], NOW);
    expect(row.ageDays).toBe(2);
    expect(row.stale).toBe(false);
  });

  it('no history means unknown age — never a guessed age', () => {
    const row = buildFreshnessRow(PRODUCT, [], NOW);
    expect(row.lastRecordedAt).toBeNull();
    expect(row.lastRecordedLabel).toBeNull();
    expect(row.ageDays).toBeNull();
    expect(row.stale).toBe(false);
    expect(row.pointCount).toBe(0);
  });

  it('a present image and GTIN clear the flags', () => {
    const row = buildFreshnessRow(
      { ...PRODUCT, imageUrl: 'https://example.com/img.jpg', gtin: '1234567890123' },
      POINTS,
      NOW
    );
    expect(row.missingImage).toBe(false);
    expect(row.missingGtin).toBe(false);
  });
});

describe('summarizeFreshness', () => {
  it('counts stale, missing-image, missing-GTIN and total points across rows', () => {
    const rows = [
      buildFreshnessRow(PRODUCT, POINTS, NOW),
      buildFreshnessRow({ ...PRODUCT, id: 'p2', slug: 'other' }, [], NOW),
    ];
    const summary = summarizeFreshness(rows);
    expect(summary.total).toBe(2);
    expect(summary.staleCount).toBe(1);
    expect(summary.unknownAgeCount).toBe(1);
    expect(summary.missingImageCount).toBe(2);
    expect(summary.missingGtinCount).toBe(2);
    expect(summary.totalPoints).toBe(4);
    expect(summary.productsWithHistory).toBe(1);
  });
});
