import { describe, expect, it } from 'vitest';
import { monthsUntil, planFutureYou, validateFutureYouGoal } from '@/lib/future-you';

const NOW = new Date(2026, 10, 10); // 10 Nov 2026

describe('planFutureYou', () => {
  it('divides the remaining amount by the months until the target date', () => {
    const plan = planFutureYou({
      targetUsd: 1200,
      savedSoFarUsd: 0,
      targetDate: '2027-05-10',
      now: NOW,
    });
    expect(plan.status).toBe('on_track');
    expect(plan.monthsRemaining).toBe(6);
    expect(plan.monthlySavingUsd).toBe(200);
    expect(plan.totalRemainingUsd).toBe(1200);
  });

  it('subtracts what is already saved before dividing', () => {
    const plan = planFutureYou({
      targetUsd: 1200,
      savedSoFarUsd: 300,
      targetDate: '2027-05-10',
      now: NOW,
    });
    expect(plan.monthlySavingUsd).toBe(150);
    expect(plan.totalRemainingUsd).toBe(900);
  });

  it('says plainly when the target date has passed', () => {
    const plan = planFutureYou({
      targetUsd: 500,
      savedSoFarUsd: 0,
      targetDate: '2026-10-01',
      now: NOW,
    });
    expect(plan.status).toBe('date_passed');
    expect(plan.monthlySavingUsd).toBeNull();
    expect(plan.message).toContain('nayi date chuno');
  });

  it('flags a monthly amount above the monthly budget as unrealistic', () => {
    const plan = planFutureYou({
      targetUsd: 1200,
      savedSoFarUsd: 0,
      targetDate: '2027-02-10',
      monthlyBudgetUsd: 100,
      now: NOW,
    });
    expect(plan.status).toBe('unrealistic');
    expect(plan.unrealistic).toBe(true);
    expect(plan.monthlySavingUsd).toBe(400);
    expect(plan.message).toContain('monthly budget');
  });

  it('does not flag a monthly amount inside the budget', () => {
    const plan = planFutureYou({
      targetUsd: 1200,
      savedSoFarUsd: 0,
      targetDate: '2027-05-10',
      monthlyBudgetUsd: 250,
      now: NOW,
    });
    expect(plan.status).toBe('on_track');
    expect(plan.unrealistic).toBe(false);
  });

  it('asks for the full remaining amount when the target is this month', () => {
    const plan = planFutureYou({
      targetUsd: 300,
      savedSoFarUsd: 0,
      targetDate: '2026-11-25',
      now: NOW,
    });
    expect(plan.status).toBe('on_track');
    expect(plan.monthsRemaining).toBe(0);
    expect(plan.monthlySavingUsd).toBe(300);
  });

  it('reports already saved when the target is reached', () => {
    const plan = planFutureYou({
      targetUsd: 500,
      savedSoFarUsd: 500,
      targetDate: '2027-05-10',
      now: NOW,
    });
    expect(plan.status).toBe('already_saved');
    expect(plan.monthlySavingUsd).toBe(0);
  });

  it('rejects a non-positive target', () => {
    const plan = planFutureYou({ targetUsd: 0, targetDate: '2027-05-10', now: NOW });
    expect(plan.status).toBe('invalid');
    expect(plan.monthlySavingUsd).toBeNull();
  });

  it('rejects an invalid target date', () => {
    const plan = planFutureYou({ targetUsd: 500, targetDate: 'not-a-date', now: NOW });
    expect(plan.status).toBe('invalid');
  });
});

describe('monthsUntil', () => {
  it('counts whole calendar months', () => {
    expect(monthsUntil(new Date(2027, 4, 10), NOW)).toBe(6);
    expect(monthsUntil(new Date(2026, 11, 10), NOW)).toBe(1);
    // Same month, later day: 0 whole months.
    expect(monthsUntil(new Date(2026, 10, 25), NOW)).toBe(0);
    // Target day earlier than today's day: one month less.
    expect(monthsUntil(new Date(2027, 4, 5), NOW)).toBe(5);
  });
});

describe('validateFutureYouGoal', () => {
  it('accepts a valid goal', () => {
    expect(
      validateFutureYouGoal({ name: 'New phone', targetUsd: 600, targetDate: '2027-05-10' })
    ).toEqual([]);
  });

  it('lists every problem in a bad goal', () => {
    const errors = validateFutureYouGoal({ name: '  ', targetUsd: -5, targetDate: 'nope' });
    expect(errors.length).toBe(3);
  });
});
