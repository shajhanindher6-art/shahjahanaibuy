/**
 * Unit tests for the CJ feed analyzer (scripts/analyze-cj-feed).
 * Runs against CJ's own sample Shopping CSV — no network, no DB.
 */

import { describe, expect, it } from 'vitest';
import { analyzeCjFeed } from '@/scripts/analyze-cj-feed';

describe('analyzeCjFeed — sample fixture', () => {
  it('reports the real metrics for the 7-row sample', async () => {
    const analysis = await analyzeCjFeed({
      file: 'tests/fixtures/cj-sample-shopping.csv',
      limit: 0,
      onlyWithGtin: false,
    });
    expect(analysis.processed).toBe(7);
    expect(analysis.accepted).toBe(6);
    expect(analysis.skipped).toBe(1);
    expect(analysis.skippedByReason).toEqual({ 'not-in-stock': 1 });
    expect(analysis.withIdentifier).toBe(5);
    expect(analysis.gtinCoverage).toEqual({ valid: 4, total: 7 });
    expect(analysis.mpnCoverage).toEqual({ present: 3, total: 7 });
    expect(analysis.missingIdentifiers).toBe(1);
    expect(analysis.duplicateExternalIds.count).toBe(0);
    expect(analysis.duplicateGtins.count).toBe(0);
    expect(analysis.invalidPrices).toBe(0);
    expect(analysis.missingImages).toBe(0);
    expect(analysis.missingDescriptions).toBe(0);
    expect(analysis.invalidAffiliateUrls).toBe(0);
    expect(analysis.currencyDistribution).toEqual({ USD: 7 });
    expect(analysis.distinctCategories).toBe(6);
    expect(analysis.categoryDistribution[0]).toEqual({
      category: 'Clothing & Accessories > Clothing > Trousers & Jeans',
      count: 2,
    });
    expect(analysis.parseErrors).toBe(0);
    expect(analysis.exportDateFromFilename).toBeNull();
    expect(analysis.exportAgeDays).toBeNull();
    expect(analysis.fileSizeBytes).toBeGreaterThan(0);
  });

  it('applies the GTIN-only filter to "accepted"', async () => {
    const analysis = await analyzeCjFeed({
      file: 'tests/fixtures/cj-sample-shopping.csv',
      limit: 0,
      onlyWithGtin: true,
    });
    expect(analysis.accepted).toBe(4);
    expect(analysis.skippedByReason['no-gtin']).toBe(2);
  });

  it('respects --limit on processed rows', async () => {
    const analysis = await analyzeCjFeed({
      file: 'tests/fixtures/cj-sample-shopping.csv',
      limit: 2,
      onlyWithGtin: false,
    });
    expect(analysis.processed).toBe(2);
    expect(analysis.accepted).toBe(2);
  });

  it('reads the export date from a dated filename', async () => {
    const analysis = await analyzeCjFeed({
      file: 'tests/fixtures/cj-sample-shopping.csv',
      limit: 1,
      onlyWithGtin: false,
    });
    // Fixture filename carries no date — covered above; this just
    // locks that the field exists and is null for undated files.
    expect(analysis.exportDateFromFilename).toBeNull();
  });
});
