/**
 * Tests for the AI Best-Time-to-Buy Calendar (Section 7 item 7).
 * Pure functions — no DB, no network. Ranges only, never exact dates.
 */
import { describe, it, expect } from 'vitest';
import {
  buildBestTimeCalendar,
  bestWindowLabel,
  MONTH_NAMES,
  BEST_TIME_MIN_POINTS,
  BEST_TIME_MIN_MONTHS,
} from '@/lib/best-time-calendar';

function points(category: string, entries: Array<[price: number, iso: string]>) {
  return entries.map(([price, recordedAt]) => ({ category, price, recordedAt }));
}

describe('bestWindowLabel', () => {
  it('names a single month', () => {
    expect(bestWindowLabel([10])).toBe('November');
  });

  it('names a range from first to last best month', () => {
    expect(bestWindowLabel([11, 9, 10])).toBe('October–December');
  });

  it('returns null with no months', () => {
    expect(bestWindowLabel([])).toBeNull();
  });
});

describe('buildBestTimeCalendar', () => {
  it('returns no categories when there are no points', () => {
    expect(buildBestTimeCalendar([])).toEqual([]);
  });

  it('marks a category insufficient with too few points', () => {
    const calendars = buildBestTimeCalendar(
      points('Laptops', [
        [999, '2026-10-05T00:00:00Z'],
        [989, '2026-10-20T00:00:00Z'],
      ])
    );
    expect(calendars).toHaveLength(1);
    expect(calendars[0].status).toBe('insufficient');
    expect(calendars[0].bestWindow).toBeNull();
    expect(calendars[0].reason).toContain(`${BEST_TIME_MIN_POINTS}`);
  });

  it('marks a category insufficient when points span only one month', () => {
    const calendars = buildBestTimeCalendar(
      points('Phones', [
        [699, '2026-10-02T00:00:00Z'],
        [689, '2026-10-12T00:00:00Z'],
        [679, '2026-10-22T00:00:00Z'],
      ])
    );
    expect(calendars[0].status).toBe('insufficient');
    expect(calendars[0].monthsCovered).toBe(1);
    expect(calendars[0].reason).toContain(`${BEST_TIME_MIN_MONTHS}`);
  });

  it('names November the best month when its recorded low is lowest', () => {
    const calendars = buildBestTimeCalendar(
      points('Laptops', [
        [1099, '2026-09-10T00:00:00Z'],
        [1049, '2026-10-10T00:00:00Z'],
        [899, '2026-11-15T00:00:00Z'],
        [999, '2026-12-10T00:00:00Z'],
      ])
    );
    expect(calendars[0].status).toBe('ready');
    expect(calendars[0].bestMonths.map((m) => m.monthName)).toEqual(['November']);
    expect(calendars[0].bestWindow).toBe('November');
    expect(calendars[0].lowestPrice).toBe(899);
  });

  it('attaches Black Friday / 11.11 labels only to a best November', () => {
    const calendars = buildBestTimeCalendar(
      points('Laptops', [
        [1099, '2026-09-10T00:00:00Z'],
        [899, '2026-11-15T00:00:00Z'],
        [999, '2026-12-10T00:00:00Z'],
      ])
    );
    const november = calendars[0].bestMonths.find((m) => m.month === 10);
    expect(november?.seasonalLabels).toContain('Black Friday season');
    expect(november?.seasonalLabels).toContain('11.11 sale season');
  });

  it('does not attach November labels when November is not a best month', () => {
    const calendars = buildBestTimeCalendar(
      points('TVs', [
        [799, '2026-11-15T00:00:00Z'],
        [599, '2026-12-10T00:00:00Z'],
        [649, '2026-10-10T00:00:00Z'],
      ])
    );
    expect(calendars[0].bestMonths.map((m) => m.monthName)).toEqual(['December']);
    expect(calendars[0].bestMonths[0].seasonalLabels).toContain('Year-end sale season');
    expect(calendars[0].bestMonths[0].seasonalLabels).not.toContain('Black Friday season');
  });

  it('groups multiple months within 5% of the lowest as best', () => {
    const calendars = buildBestTimeCalendar(
      points('Headphones', [
        [200, '2026-09-10T00:00:00Z'],
        [100, '2026-11-15T00:00:00Z'],
        [103, '2026-12-10T00:00:00Z'],
        [150, '2026-10-10T00:00:00Z'],
      ])
    );
    expect(calendars[0].bestMonths.map((m) => m.monthName)).toEqual(['November', 'December']);
    expect(calendars[0].bestWindow).toBe('November–December');
  });

  it('builds one calendar per category, sorted by name', () => {
    const calendars = buildBestTimeCalendar([
      ...points('Phones', [
        [699, '2026-10-02T00:00:00Z'],
        [599, '2026-11-02T00:00:00Z'],
        [649, '2026-12-02T00:00:00Z'],
      ]),
      ...points('Laptops', [
        [1099, '2026-10-02T00:00:00Z'],
        [899, '2026-11-02T00:00:00Z'],
        [999, '2026-12-02T00:00:00Z'],
      ]),
    ]);
    expect(calendars.map((c) => c.category)).toEqual(['Laptops', 'Phones']);
    expect(MONTH_NAMES[10]).toBe('November');
  });

  it('ignores invalid points instead of crashing', () => {
    const calendars = buildBestTimeCalendar([
      { category: 'Laptops', price: NaN, recordedAt: '2026-11-01T00:00:00Z' },
      { category: 'Laptops', price: 899, recordedAt: 'not-a-date' },
      { category: '', price: 899, recordedAt: '2026-11-01T00:00:00Z' },
    ]);
    expect(calendars).toEqual([]);
  });
});
