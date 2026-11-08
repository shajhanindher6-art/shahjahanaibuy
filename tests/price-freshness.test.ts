import { describe, it, expect } from 'vitest';
import { latestRecordedAt, formatLastChecked } from '@/lib/price-freshness';

// Local-noon dates: formatting a local noon never crosses a day
// boundary in any timezone, so the expected strings are exact.
const NOV_8_2026_NOON = new Date(2026, 10, 8, 12, 0, 0);
const OCT_26_2026_NOON = new Date(2026, 9, 26, 12, 0, 0);

describe('latestRecordedAt', () => {
  it('returns the max recorded_at from unsorted points', () => {
    expect(
      latestRecordedAt([
        { recordedAt: '2026-10-26T00:00:00.000Z' },
        { recordedAt: '2026-11-08T00:00:00.000Z' },
        { recordedAt: '2026-11-01T00:00:00.000Z' },
      ]),
    ).toBe('2026-11-08T00:00:00.000Z');
  });

  it('returns null for empty, null, or undefined input', () => {
    expect(latestRecordedAt([])).toBeNull();
    expect(latestRecordedAt(null)).toBeNull();
    expect(latestRecordedAt(undefined)).toBeNull();
  });

  it('skips null entries, missing values, and unparseable dates', () => {
    expect(
      latestRecordedAt([
        null,
        {},
        { recordedAt: null },
        { recordedAt: 'not-a-date' },
        { recordedAt: '2026-10-26T00:00:00.000Z' },
      ]),
    ).toBe('2026-10-26T00:00:00.000Z');
  });

  it('returns null when no point has a parseable date', () => {
    expect(latestRecordedAt([{ recordedAt: 'garbage' }, { recordedAt: '' }])).toBeNull();
  });

  it('returns the single value when only one point is valid', () => {
    expect(latestRecordedAt([{ recordedAt: '2026-11-08T00:00:00.000Z' }])).toBe(
      '2026-11-08T00:00:00.000Z',
    );
  });
});

describe('formatLastChecked', () => {
  it('formats a Date as "Mon D, YYYY"', () => {
    expect(formatLastChecked(NOV_8_2026_NOON)).toBe('Nov 8, 2026');
    expect(formatLastChecked(OCT_26_2026_NOON)).toBe('Oct 26, 2026');
  });

  it('formats a valid ISO string', () => {
    // ISO input is parsed in the viewer's timezone, so only assert the
    // year survives; the exact day is covered by the Date cases above.
    const formatted = formatLastChecked('2026-11-08T12:00:00.000Z');
    expect(formatted).not.toBeNull();
    expect(formatted).toContain('2026');
  });

  it('returns null for missing, empty, or invalid input', () => {
    expect(formatLastChecked(null)).toBeNull();
    expect(formatLastChecked(undefined)).toBeNull();
    expect(formatLastChecked('')).toBeNull();
    expect(formatLastChecked('not-a-date')).toBeNull();
    expect(formatLastChecked(new Date('invalid'))).toBeNull();
  });
});
