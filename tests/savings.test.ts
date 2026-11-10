import { describe, expect, it } from 'vitest';
import {
  computeSavingsAmount,
  deriveSavingsSummary,
  deriveStreak,
  roundToCents,
  saverBadgeForEventCount,
  saverBadgeLabel,
  savingsAmountMatches,
  weeksWithEventsFromDates,
} from '@/lib/savings';

describe('computeSavingsAmount', () => {
  it('returns compare-at minus purchase price, rounded to cents', () => {
    expect(computeSavingsAmount(1018.98, 999)).toBe(19.98);
    expect(computeSavingsAmount(100.1, 99.99)).toBe(0.11);
  });

  it('returns null when nothing was saved', () => {
    expect(computeSavingsAmount(999, 999)).toBeNull();
    expect(computeSavingsAmount(900, 999)).toBeNull();
  });

  it('returns null for missing or non-finite prices — never a guessed saving', () => {
    expect(computeSavingsAmount(null, 999)).toBeNull();
    expect(computeSavingsAmount(1018.98, null)).toBeNull();
    expect(computeSavingsAmount(undefined, undefined)).toBeNull();
    expect(computeSavingsAmount(NaN, 999)).toBeNull();
    expect(computeSavingsAmount(1018.98, Infinity)).toBeNull();
  });
});

describe('savingsAmountMatches', () => {
  it('accepts the exact recorded saving to the cent', () => {
    expect(savingsAmountMatches(19.98, 19.98)).toBe(true);
    // Float dust on either side still matches after cent rounding.
    expect(savingsAmountMatches(19.979, 19.98)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(savingsAmountMatches(19.97, 19.98)).toBe(false);
    expect(savingsAmountMatches(25, 19.98)).toBe(false);
    expect(savingsAmountMatches(0, 19.98)).toBe(false);
    expect(savingsAmountMatches(-5, 19.98)).toBe(false);
    expect(savingsAmountMatches('19.98', 19.98)).toBe(false);
    expect(savingsAmountMatches(19.98, null)).toBe(false);
  });
});

describe('roundToCents', () => {
  it('rounds half-up to whole cents', () => {
    expect(roundToCents(19.985)).toBe(19.99);
    expect(roundToCents(10.004)).toBe(10);
  });
});

describe('deriveStreak', () => {
  it('counts consecutive true weeks back from the most recent week', () => {
    expect(deriveStreak([])).toBe(0);
    expect(deriveStreak([true])).toBe(1);
    expect(deriveStreak([true, true, true])).toBe(3);
    expect(deriveStreak([true, false, true])).toBe(1);
    expect(deriveStreak([true, true, false])).toBe(0);
    expect(deriveStreak([false, true, true, false, true, true])).toBe(2);
  });
});

describe('weeksWithEventsFromDates', () => {
  const now = new Date('2026-11-10T12:00:00Z');

  it('builds oldest→newest week flags from ledger timestamps', () => {
    // 2 days ago (this week), 10 days ago (last week), 24 days ago (3 weeks back).
    const weeks = weeksWithEventsFromDates(
      ['2026-11-08T10:00:00Z', '2026-10-31T10:00:00Z', '2026-10-17T10:00:00Z'],
      now
    );
    // Weeks ago 3, 2, 1, 0 → [true, false, true, true].
    expect(weeks).toEqual([true, false, true, true]);
    expect(deriveStreak(weeks)).toBe(2);
  });

  it('returns [] with no events and ignores future-dated rows', () => {
    expect(weeksWithEventsFromDates([], now)).toEqual([]);
    expect(weeksWithEventsFromDates(['2026-12-01T00:00:00Z'], now)).toEqual([]);
    expect(weeksWithEventsFromDates([null, undefined, 'not-a-date'], now)).toEqual([]);
  });
});

describe('saverBadgeForEventCount', () => {
  it('walks the 1/5/15/30 ladder, reusing the creator-rewards thresholds', () => {
    expect(saverBadgeForEventCount(0)).toBe('none');
    expect(saverBadgeForEventCount(1)).toBe('bronze');
    expect(saverBadgeForEventCount(4)).toBe('bronze');
    expect(saverBadgeForEventCount(5)).toBe('silver');
    expect(saverBadgeForEventCount(14)).toBe('silver');
    expect(saverBadgeForEventCount(15)).toBe('gold');
    expect(saverBadgeForEventCount(29)).toBe('gold');
    expect(saverBadgeForEventCount(30)).toBe('platinum');
    expect(saverBadgeForEventCount(100)).toBe('platinum');
  });

  it('never awards a badge for zero or invalid counts', () => {
    expect(saverBadgeForEventCount(-1)).toBe('none');
    expect(saverBadgeForEventCount(NaN)).toBe('none');
  });

  it('labels saver badges', () => {
    expect(saverBadgeLabel('none')).toBe('No badge yet');
    expect(saverBadgeLabel('bronze')).toBe('Bronze Saver');
    expect(saverBadgeLabel('platinum')).toBe('Platinum Saver');
  });
});

describe('deriveSavingsSummary', () => {
  const now = new Date('2026-11-10T12:00:00Z');

  it('derives total, count, streak, and badge from the ledger', () => {
    const summary = deriveSavingsSummary(
      [
        { amountSavedUsd: 19.98, recordedAt: '2026-11-08T10:00:00Z' },
        { amountSavedUsd: 5.5, recordedAt: '2026-11-01T10:00:00Z' },
        { amountSavedUsd: 10, recordedAt: '2026-10-25T10:00:00Z' },
      ],
      now
    );
    expect(summary.totalSavedUsd).toBe(35.48);
    expect(summary.eventCount).toBe(3);
    // Events in the current, previous, and prior weeks: 3-week streak.
    expect(summary.streakWeeks).toBe(3);
    expect(summary.badge).toBe('bronze');
  });

  it('is an honest empty state for an empty ledger', () => {
    expect(deriveSavingsSummary([], now)).toEqual({
      totalSavedUsd: 0,
      eventCount: 0,
      streakWeeks: 0,
      badge: 'none',
    });
  });

  it('ignores non-finite amounts when totalling', () => {
    const summary = deriveSavingsSummary(
      [
        { amountSavedUsd: 10, recordedAt: '2026-11-08T10:00:00Z' },
        { amountSavedUsd: NaN, recordedAt: '2026-11-08T10:00:00Z' },
      ],
      now
    );
    expect(summary.totalSavedUsd).toBe(10);
    expect(summary.eventCount).toBe(2);
  });
});
