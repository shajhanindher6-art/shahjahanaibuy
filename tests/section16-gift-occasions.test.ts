import { describe, expect, it } from 'vitest';
import {
  GIFT_OCCASION_LEAD_DAYS,
  parseGiftOccasionParams,
  planGiftOccasion,
  planGiftOccasions,
} from '@/lib/gift-occasions';

const NOW = new Date('2026-11-12T12:00:00Z');

describe('planGiftOccasion', () => {
  it('plans an upcoming occasion with days-until and a 7-day order-by date', () => {
    const p = planGiftOccasion({ name: 'Birthday', date: '2026-12-12', budgetUsd: 100 }, NOW);
    expect(p?.status).toBe('upcoming');
    expect(p?.daysUntil).toBe(30);
    expect(p?.orderByDate).toBe('2026-12-05');
    expect(GIFT_OCCASION_LEAD_DAYS).toBe(7);
  });

  it('marks today’s occasion as today, with no wait', () => {
    const p = planGiftOccasion({ name: 'Anniversary', date: '2026-11-12', budgetUsd: 50 }, NOW);
    expect(p?.status).toBe('today');
    expect(p?.daysUntil).toBe(0);
  });

  it('marks a past occasion as passed, with no order-by date and no pick to make', () => {
    const p = planGiftOccasion({ name: 'Eid', date: '2026-11-01', budgetUsd: 50 }, NOW);
    expect(p?.status).toBe('passed');
    expect(p?.daysUntil).toBe(-11);
    expect(p?.orderByDate).toBeNull();
  });

  it('rejects invalid rows instead of inventing a plan', () => {
    expect(planGiftOccasion({ name: '', date: '2026-12-12', budgetUsd: 100 }, NOW)).toBeNull();
    expect(planGiftOccasion({ name: 'X', date: 'not-a-date', budgetUsd: 100 }, NOW)).toBeNull();
    expect(planGiftOccasion({ name: 'X', date: '2026-12-12', budgetUsd: 0 }, NOW)).toBeNull();
  });

  it('sorts a plan soonest-first', () => {
    const plans = planGiftOccasions(
      [
        { name: 'Christmas', date: '2026-12-25', budgetUsd: 200 },
        { name: 'Birthday', date: '2026-11-20', budgetUsd: 100 },
      ],
      NOW
    );
    expect(plans.map((p) => p.name)).toEqual(['Birthday', 'Christmas']);
  });
});

describe('parseGiftOccasionParams', () => {
  it('parses aligned repeated rows and ignores blank rows', () => {
    const p = parseGiftOccasionParams({
      name: ['Birthday', '', 'Christmas'],
      date: ['2026-12-12', '', '2026-12-25'],
      budget: ['100', '', '200'],
    });
    expect(p.occasions).toEqual([
      { name: 'Birthday', date: '2026-12-12', budgetUsd: 100 },
      { name: 'Christmas', date: '2026-12-25', budgetUsd: 200 },
    ]);
    expect(p.errors).toEqual([]);
    expect(p.hasQuery).toBe(true);
  });

  it('reports bad rows instead of silently dropping them', () => {
    const p = parseGiftOccasionParams({
      name: ['No date', 'No budget'],
      date: ['', '2026-12-25'],
      budget: ['100', 'zero'],
    });
    expect(p.occasions).toEqual([]);
    expect(p.errors).toHaveLength(2);
  });
});
