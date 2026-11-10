import { describe, expect, it } from 'vitest';
import {
  checkProtectionEligibility,
  isMissingTableError,
  isValidStatusTransition,
  lowestInWindowPrice,
  windowEndDate,
  type PricePoint,
} from '@/lib/price-protection';

const PURCHASE_DATE = '2026-10-01T00:00:00.000Z';
const NOW_IN_WINDOW = new Date('2026-10-15T12:00:00Z');
const NOW_AFTER_WINDOW = new Date('2026-11-15T12:00:00Z');

function points(list: Array<[string, number | null]>): PricePoint[] {
  return list.map(([recordedAt, price]) => ({ recordedAt, price }));
}

describe('windowEndDate', () => {
  it('adds windowDays to the purchase date', () => {
    expect(windowEndDate(PURCHASE_DATE, 30)).toBe('2026-10-31T00:00:00.000Z');
    expect(windowEndDate(PURCHASE_DATE, 7)).toBe('2026-10-08T00:00:00.000Z');
  });

  it('returns null for an invalid purchase date', () => {
    expect(windowEndDate('not-a-date', 30)).toBeNull();
  });
});

describe('lowestInWindowPrice', () => {
  it('returns the lowest price strictly inside (purchase, purchase + window]', () => {
    const lowest = lowestInWindowPrice(
      PURCHASE_DATE,
      30,
      points([
        ['2026-10-01T00:00:00.000Z', 500], // ON the purchase date: excluded
        ['2026-10-05T00:00:00.000Z', 950],
        ['2026-10-20T00:00:00.000Z', 899],
        ['2026-10-31T00:00:00.000Z', 920], // window end: included
        ['2026-11-01T00:00:00.000Z', 800], // after the window: excluded
      ])
    );
    expect(lowest).toBe(899);
  });

  it('returns null when no point falls inside the window', () => {
    expect(
      lowestInWindowPrice(PURCHASE_DATE, 30, points([['2026-09-01T00:00:00.000Z', 100]]))
    ).toBeNull();
    expect(lowestInWindowPrice(PURCHASE_DATE, 30, [])).toBeNull();
  });

  it('ignores null prices and invalid window inputs', () => {
    expect(
      lowestInWindowPrice(
        PURCHASE_DATE,
        30,
        points([
          ['2026-10-05T00:00:00.000Z', null],
          ['2026-10-06T00:00:00.000Z', 950],
        ])
      )
    ).toBe(950);
    expect(lowestInWindowPrice(PURCHASE_DATE, 0, points([['2026-10-05T00:00:00.000Z', 950]]))).toBeNull();
    expect(lowestInWindowPrice('bad-date', 30, points([['2026-10-05T00:00:00.000Z', 950]]))).toBeNull();
  });
});

describe('checkProtectionEligibility', () => {
  it('is eligible only when the lowest in-window price is below the purchase price', () => {
    expect(
      checkProtectionEligibility({
        purchasePrice: 999,
        purchaseDate: PURCHASE_DATE,
        windowDays: 30,
        pricePoints: points([
          ['2026-10-05T00:00:00.000Z', 999], // equal: not a drop
          ['2026-10-20T00:00:00.000Z', 899], // drop: eligible
        ]),
        now: NOW_IN_WINDOW,
      })
    ).toBe('eligible');
  });

  it('is not_eligible while the window is open and no price dropped', () => {
    expect(
      checkProtectionEligibility({
        purchasePrice: 999,
        purchaseDate: PURCHASE_DATE,
        windowDays: 30,
        pricePoints: points([['2026-10-05T00:00:00.000Z', 999]]),
        now: NOW_IN_WINDOW,
      })
    ).toBe('not_eligible');
  });

  it('is expired once the window closed with no drop', () => {
    expect(
      checkProtectionEligibility({
        purchasePrice: 999,
        purchaseDate: PURCHASE_DATE,
        windowDays: 30,
        pricePoints: points([['2026-10-05T00:00:00.000Z', 1050]]),
        now: NOW_AFTER_WINDOW,
      })
    ).toBe('expired');
  });

  it('is still eligible after the window closed when a drop happened inside it', () => {
    expect(
      checkProtectionEligibility({
        purchasePrice: 999,
        purchaseDate: PURCHASE_DATE,
        windowDays: 30,
        pricePoints: points([['2026-10-20T00:00:00.000Z', 899]]),
        now: NOW_AFTER_WINDOW,
      })
    ).toBe('eligible');
  });

  it('is no_data with a null purchase price', () => {
    expect(
      checkProtectionEligibility({
        purchasePrice: null,
        purchaseDate: PURCHASE_DATE,
        windowDays: 30,
        pricePoints: points([['2026-10-05T00:00:00.000Z', 100]]),
        now: NOW_IN_WINDOW,
      })
    ).toBe('no_data');
  });

  it('is no_data with fewer than 1 point inside the window', () => {
    expect(
      checkProtectionEligibility({
        purchasePrice: 999,
        purchaseDate: PURCHASE_DATE,
        windowDays: 30,
        pricePoints: [],
        now: NOW_IN_WINDOW,
      })
    ).toBe('no_data');
    // A point on the purchase date itself does not count.
    expect(
      checkProtectionEligibility({
        purchasePrice: 999,
        purchaseDate: PURCHASE_DATE,
        windowDays: 30,
        pricePoints: points([['2026-10-01T00:00:00.000Z', 100]]),
        now: NOW_IN_WINDOW,
      })
    ).toBe('no_data');
  });

  it('is no_data for an invalid window or purchase date', () => {
    expect(
      checkProtectionEligibility({
        purchasePrice: 999,
        purchaseDate: PURCHASE_DATE,
        windowDays: 0,
        pricePoints: points([['2026-10-05T00:00:00.000Z', 100]]),
        now: NOW_IN_WINDOW,
      })
    ).toBe('no_data');
    expect(
      checkProtectionEligibility({
        purchasePrice: 999,
        purchaseDate: 'bad-date',
        windowDays: 30,
        pricePoints: points([['2026-10-05T00:00:00.000Z', 100]]),
        now: NOW_IN_WINDOW,
      })
    ).toBe('no_data');
  });

  it('ignores null prices and points outside the window', () => {
    expect(
      checkProtectionEligibility({
        purchasePrice: 999,
        purchaseDate: PURCHASE_DATE,
        windowDays: 30,
        pricePoints: points([
          ['2026-09-15T00:00:00.000Z', 100], // before purchase: ignored
          ['2026-10-05T00:00:00.000Z', null], // null: ignored
          ['2026-11-05T00:00:00.000Z', 100], // after window: ignored
          ['2026-10-10T00:00:00.000Z', 1000],
        ]),
        now: NOW_IN_WINDOW,
      })
    ).toBe('not_eligible');
  });
});

describe('isValidStatusTransition', () => {
  it('accepts only claim_submitted', () => {
    expect(isValidStatusTransition('claim_submitted')).toBe(true);
    expect(isValidStatusTransition('eligible')).toBe(false);
    expect(isValidStatusTransition('pending')).toBe(false);
    expect(isValidStatusTransition('expired')).toBe(false);
    expect(isValidStatusTransition(undefined)).toBe(false);
  });
});

describe('isMissingTableError (price-protection)', () => {
  it('treats both 42P01 and PGRST205 as missing table', () => {
    expect(isMissingTableError({ code: '42P01' })).toBe(true);
    expect(isMissingTableError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTableError({ code: '23505' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});
