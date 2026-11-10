/**
 * Tests for the market-report builders (lib/market-reports.ts).
 *
 * Pure builders: recorded drops / index values in, report copy out.
 * Nothing here reads a database, so a report can never silently
 * invent a figure its inputs lack — these tests pin the honest
 * empty states, the data-quality gates, and the 90-day rule for
 * "best time to buy" claims.
 */

import { describe, expect, it } from 'vitest';
import {
  EDITORIAL_GUIDELINES,
  buildCategoryDeepDive,
  buildSeasonalGuide,
  buildWeeklyDealReport,
  dataQualityFor,
  dataQualityLabel,
  reportSlug,
} from '@/lib/market-reports';

const THIN = { products: 3, points: 10, historyDays: 30 };
const SUFFICIENT = { products: 11, points: 40, historyDays: 120 };

describe('dataQualityFor / dataQualityLabel', () => {
  it('is insufficient below 5 points', () => {
    expect(dataQualityFor({ products: 1, points: 4, historyDays: 200 })).toBe('insufficient');
    expect(dataQualityLabel('insufficient')).toBe('Not enough data yet');
  });

  it('is sufficient only with 90+ days and 20+ points', () => {
    expect(dataQualityFor(SUFFICIENT)).toBe('sufficient');
    expect(dataQualityLabel('sufficient')).toBe('Good data depth');
    // 90 days but too few points → thin.
    expect(dataQualityFor({ products: 5, points: 19, historyDays: 120 })).toBe('thin');
    // Plenty of points but too few days → thin.
    expect(dataQualityFor({ products: 5, points: 50, historyDays: 89 })).toBe('thin');
    expect(dataQualityLabel('thin')).toBe('Thin data — read with care');
  });
});

describe('reportSlug', () => {
  it('slugifies the period label', () => {
    expect(reportSlug('weekly-deal-report', 'Week of Nov 3, 2026')).toBe(
      'weekly-deal-report-week-of-nov-3-2026'
    );
    expect(reportSlug('seasonal-guide', 'Black Friday 2026')).toBe(
      'seasonal-guide-black-friday-2026'
    );
  });
});

describe('buildWeeklyDealReport', () => {
  it('is an honest empty report with no recorded drops', () => {
    const report = buildWeeklyDealReport({ drops: [], weekLabel: 'Week of Nov 3, 2026', depth: THIN });
    expect(report.kind).toBe('weekly-deal-report');
    expect(report.summary).toBe('No price drops were recorded this week.');
    expect(report.findings[0]).toContain('No price drops were recorded this week');
    expect(report.dataQuality).toBe('thin');
    expect(report.methodology).toContain('recorded price history only');
  });

  it('ranks the biggest drops first, caps at 5, and reports the median', () => {
    const drops = [5, 12, 20, 8, 15, 3].map((pct, i) => ({
      productName: `Product ${i}`,
      category: 'Laptops',
      dropPct: pct,
      oldPrice: 1000,
      newPrice: 1000 * (1 - pct / 100),
      date: '2026-11-05T00:00:00Z',
    }));
    const report = buildWeeklyDealReport({ drops, weekLabel: 'Week of Nov 3, 2026', depth: SUFFICIENT });
    expect(report.summary).toContain('largest 20.0% on Product 2');
    expect(report.findings[0]).toContain('Product 2 dropped 20.0%');
    // 5 largest: 20, 15, 12, 8, 5 → median 12.0.
    expect(report.findings[5]).toContain('Median drop among the 5 largest recorded drops this week: 12.0%');
    expect(report.dataQuality).toBe('sufficient');
  });

  it('ignores zero/negative/invalid drops', () => {
    const report = buildWeeklyDealReport({
      drops: [
        { productName: 'Flat', category: null, dropPct: 0, oldPrice: 100, newPrice: 100, date: '2026-11-05T00:00:00Z' },
        { productName: 'Up', category: null, dropPct: -2, oldPrice: 100, newPrice: 102, date: '2026-11-05T00:00:00Z' },
      ],
      weekLabel: 'Week of Nov 3, 2026',
      depth: THIN,
    });
    expect(report.summary).toBe('No price drops were recorded this week.');
  });
});

describe('buildCategoryDeepDive', () => {
  it('says plainly when there is no index to report', () => {
    const report = buildCategoryDeepDive({
      category: 'Laptops',
      periodMonth: '2026-10',
      indexValue: null,
      baseMonth: null,
      changePct: null,
      direction: 'unknown',
      depth: { products: 0, points: 0, historyDays: 0 },
    });
    expect(report.summary).toContain('does not have enough recorded prices yet');
    expect(report.dataQuality).toBe('insufficient');
    expect(report.findings[0]).toContain('at least 2 products need recorded prices');
  });

  it('narrates the index and the month-over-month move', () => {
    const report = buildCategoryDeepDive({
      category: 'Laptops',
      periodMonth: '2026-10',
      indexValue: 97.5,
      baseMonth: '2026-09',
      changePct: -2.5,
      direction: 'down',
      depth: SUFFICIENT,
    });
    expect(report.summary).toBe('Laptops index 97.5 for 2026-10 (base 2026-09 = 100).');
    expect(report.findings[1]).toContain('Month over month, the index moved -2.5% (prices fell');
  });

  it('reports "no previous month" instead of inventing a change', () => {
    const report = buildCategoryDeepDive({
      category: 'Phones',
      periodMonth: '2026-10',
      indexValue: 100,
      baseMonth: '2026-10',
      changePct: null,
      direction: 'flat',
      depth: THIN,
    });
    expect(report.findings[1]).toContain('No previous published month exists yet');
  });
});

describe('buildSeasonalGuide', () => {
  it('is an honest empty guide with no category lows', () => {
    const report = buildSeasonalGuide({ seasonLabel: 'Black Friday 2026', categoryLows: [], depth: THIN });
    expect(report.summary).toBe('Not enough recorded prices yet for a seasonal guide.');
    expect(report.findings[0]).toContain('No category has enough recorded prices yet');
  });

  it('refuses a "best time to buy" claim below 90 days of history', () => {
    const report = buildSeasonalGuide({
      seasonLabel: 'Black Friday 2026',
      categoryLows: [{ category: 'Laptops', lowest: 900, current: 999, productsUsed: 3 }],
      depth: THIN,
    });
    expect(report.findings[0]).toContain('currently 11.0% above its recorded low ($900.00 → $999.00 now)');
    expect(report.findings[1]).toContain('cannot say when prices are lowest in the season');
    expect(report.findings[1]).toContain('at least 90 days of history');
  });

  it('allows reading seasonal patterns only at 90+ days — still as a tendency, never a promise', () => {
    const report = buildSeasonalGuide({
      seasonLabel: 'Black Friday 2026',
      categoryLows: [{ category: 'Laptops', lowest: 900, current: 999, productsUsed: 3 }],
      depth: SUFFICIENT,
    });
    expect(report.findings[1]).toContain('seasonal patterns can start to be read');
    expect(report.findings[1]).toContain('not a promise about the next season');
  });
});

describe('EDITORIAL_GUIDELINES', () => {
  it('states the recorded-data-only rule', () => {
    expect(EDITORIAL_GUIDELINES.length).toBeGreaterThan(0);
    expect(EDITORIAL_GUIDELINES[0]).toContain('recorded price history');
    expect(EDITORIAL_GUIDELINES.join(' ')).toContain('90 days');
  });
});
