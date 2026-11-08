import { describe, expect, it } from 'vitest';
import { buildDealHotspots } from '@/services/deal-hotspots';

describe('buildDealHotspots', () => {
  it('places known drop events on the right days, newest month first', () => {
    const result = buildDealHotspots({
      drops: [
        { date: '2026-10-26T10:00:00Z', productId: 'a' },
        { date: '2026-10-26T15:00:00Z', productId: 'b' },
        { date: '2026-11-02T09:00:00Z', productId: 'a' },
      ],
      deals: [
        { date: '2026-10-26T08:00:00Z', dealId: 'd1' },
        { date: '2026-11-02T08:00:00Z', dealId: 'd2' },
      ],
      historyStart: '2026-10-09T00:00:00Z',
      historyEnd: '2026-11-08T00:00:00Z',
    });

    expect(result.totalDrops).toBe(3);
    expect(result.totalDeals).toBe(2);
    expect(result.historyDays).toBe(31);
    expect(result.coverageNote).toContain('31 days');
    expect(result.coverageNote).toContain('seasonal patterns need a full year');

    // Newest month first.
    expect(result.months).toHaveLength(2);
    expect(result.months[0]).toMatchObject({ year: 2026, month: 10 }); // November
    expect(result.months[0].days).toEqual([
      { date: '2026-11-02', drops: 1, deals: 1 },
    ]);
    expect(result.months[0]).toMatchObject({ totalDrops: 1, totalDeals: 1 });

    expect(result.months[1]).toMatchObject({ year: 2026, month: 9 }); // October
    expect(result.months[1].days).toEqual([
      { date: '2026-10-26', drops: 2, deals: 1 },
    ]);
    expect(result.months[1]).toMatchObject({ totalDrops: 2, totalDeals: 1 });
  });

  it('aggregates multiple drops on the same day', () => {
    const result = buildDealHotspots({
      drops: [
        { date: '2026-11-05T01:00:00Z', productId: 'a' },
        { date: '2026-11-05T02:00:00Z', productId: 'b' },
        { date: '2026-11-05T03:00:00Z', productId: 'c' },
      ],
      deals: [],
      historyStart: '2026-11-01T00:00:00Z',
      historyEnd: '2026-11-05T00:00:00Z',
    });
    expect(result.months).toHaveLength(1);
    expect(result.months[0].days).toEqual([{ date: '2026-11-05', drops: 3, deals: 0 }]);
    expect(result.totalDrops).toBe(3);
  });

  it('returns an honest empty state for empty history', () => {
    const result = buildDealHotspots({
      drops: [],
      deals: [],
      historyStart: null,
      historyEnd: null,
    });
    expect(result.months).toEqual([]);
    expect(result.totalDrops).toBe(0);
    expect(result.totalDeals).toBe(0);
    expect(result.historyDays).toBe(0);
    expect(result.coverageNote).toBe(
      'No recorded price history yet — no hotspots to show.'
    );
  });

  it('drops events with invalid dates instead of placing them', () => {
    const result = buildDealHotspots({
      drops: [
        { date: 'not-a-date', productId: 'a' },
        { date: '2026-11-02T09:00:00Z', productId: 'b' },
      ],
      deals: [{ date: 'garbage', dealId: 'd1' }],
      historyStart: '2026-11-01T00:00:00Z',
      historyEnd: '2026-11-02T00:00:00Z',
    });
    expect(result.totalDrops).toBe(1);
    expect(result.totalDeals).toBe(0);
    expect(result.months).toHaveLength(1);
    expect(result.months[0].days).toEqual([
      { date: '2026-11-02', drops: 1, deals: 0 },
    ]);
  });

  it('never uses probability or seasonal language', () => {
    const result = buildDealHotspots({
      drops: [{ date: '2026-11-02T09:00:00Z', productId: 'a' }],
      deals: [],
      historyStart: '2026-10-09T00:00:00Z',
      historyEnd: '2026-11-08T00:00:00Z',
    });
    const text = JSON.stringify(result).toLowerCase();
    expect(text).not.toContain('probability');
    expect(text).not.toContain('high-probability');
    expect(text).not.toContain('forecast');
    expect(text).not.toContain('likely');
  });
});
