import { describe, expect, it } from 'vitest';
import {
  nextReorderDate,
  normalizeReorderIntervalDays,
  REORDER_INTERVAL_MAX_DAYS,
  REORDER_INTERVAL_MIN_DAYS,
} from '@/lib/vault-reorder';

describe('normalizeReorderIntervalDays', () => {
  it('accepts whole days in range', () => {
    expect(normalizeReorderIntervalDays(30)).toBe(30);
    expect(normalizeReorderIntervalDays(REORDER_INTERVAL_MIN_DAYS)).toBe(1);
    expect(normalizeReorderIntervalDays(REORDER_INTERVAL_MAX_DAYS)).toBe(3650);
  });

  it('floors fractional days and rejects out-of-range / non-numeric input', () => {
    expect(normalizeReorderIntervalDays(30.9)).toBe(30);
    expect(normalizeReorderIntervalDays(0)).toBeNull();
    expect(normalizeReorderIntervalDays(-5)).toBeNull();
    expect(normalizeReorderIntervalDays(3651)).toBeNull();
    expect(normalizeReorderIntervalDays('abc')).toBeNull();
    expect(normalizeReorderIntervalDays(null)).toBeNull();
    expect(normalizeReorderIntervalDays(undefined)).toBeNull();
  });
});

describe('nextReorderDate', () => {
  const now = new Date('2026-11-10T12:00:00Z');

  it('derives purchase date + interval when still ahead', () => {
    expect(nextReorderDate('2026-10-20', 30, true, now)).toEqual({
      date: '2026-11-19',
      daysUntil: 9,
      cyclesPassed: 0,
    });
  });

  it('rolls forward by whole intervals until the date is today or later', () => {
    // Bought 2026-01-01, every 30 days: Jan 31, Mar 02, Apr 01 …
    // On 2026-11-10 the next date is 2026-11-27 (10 cycles passed).
    expect(nextReorderDate('2026-01-01', 30, true, now)).toEqual({
      date: '2026-11-27',
      daysUntil: 17,
      cyclesPassed: 10,
    });
  });

  it('is due today when the rolled date lands on today', () => {
    expect(nextReorderDate('2026-10-11', 30, true, now)).toEqual({
      date: '2026-11-10',
      daysUntil: 0,
      cyclesPassed: 0,
    });
  });

  it('returns null when not consumable, no interval, or no valid purchase date', () => {
    expect(nextReorderDate('2026-10-20', 30, false, now)).toBeNull();
    expect(nextReorderDate('2026-10-20', 30, null, now)).toBeNull();
    expect(nextReorderDate('2026-10-20', null, true, now)).toBeNull();
    expect(nextReorderDate('2026-10-20', 0, true, now)).toBeNull();
    expect(nextReorderDate(null, 30, true, now)).toBeNull();
    expect(nextReorderDate('not-a-date', 30, true, now)).toBeNull();
    expect(nextReorderDate('', 30, true, now)).toBeNull();
  });
});
