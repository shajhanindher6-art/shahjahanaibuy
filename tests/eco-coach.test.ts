import { describe, expect, it } from 'vitest';
import {
  budgetStatus,
  coachNoteForPurchase,
  currentMonth,
  isValidMonth,
  normalizeBudgetKg,
  type BudgetStatus,
} from '@/lib/eco-coach';
import type { CarbonLabel } from '@/lib/sustainability';

function recordedCarbon(kg: number, band: CarbonLabel['band'] = 'B'): CarbonLabel {
  return {
    kind: 'recorded',
    kgCO2e: kg,
    band,
    categoryBaseKg: 250,
    sourceNote: 'Recorded footprint.',
  };
}

function estimateCarbon(kg: number): CarbonLabel {
  return {
    kind: 'estimate',
    kgCO2e: kg,
    band: 'C',
    categoryBaseKg: 250,
    sourceNote: 'Estimate only — not a certified lifecycle assessment.',
  };
}

const unknownCarbon: CarbonLabel = {
  kind: 'unknown',
  kgCO2e: null,
  band: null,
  categoryBaseKg: null,
  sourceNote: 'No carbon data.',
};

describe('isValidMonth / currentMonth', () => {
  it('accepts YYYY-MM months and rejects the rest', () => {
    expect(isValidMonth('2026-11')).toBe(true);
    expect(isValidMonth('2026-13')).toBe(false);
    expect(isValidMonth('2026-1')).toBe(false);
    expect(isValidMonth('Nov 2026')).toBe(false);
    expect(isValidMonth(null)).toBe(false);
  });

  it('currentMonth is a valid month', () => {
    expect(isValidMonth(currentMonth())).toBe(true);
  });
});

describe('normalizeBudgetKg', () => {
  it('accepts positive budgets and rejects zero, negative and absurd values', () => {
    expect(normalizeBudgetKg(50)).toBe(50);
    expect(normalizeBudgetKg('25.5')).toBe(25.5);
    expect(normalizeBudgetKg(0)).toBeNull();
    expect(normalizeBudgetKg(-10)).toBeNull();
    expect(normalizeBudgetKg('not-a-number')).toBeNull();
    expect(normalizeBudgetKg(100_001)).toBeNull();
  });
});

describe('budgetStatus', () => {
  it('reports within below 80% use', () => {
    const status = budgetStatus(30, 100);
    expect(status.status).toBe('within');
    expect(status.percentUsed).toBe(30);
    expect(status.remainingKg).toBe(70);
  });

  it('reports near at 80% or more, over above 100%', () => {
    expect(budgetStatus(80, 100).status).toBe('near');
    expect(budgetStatus(99.9, 100).status).toBe('near');
    const over = budgetStatus(120, 100);
    expect(over.status).toBe('over');
    expect(over.remainingKg).toBe(-20);
  });

  it('reports unknown when no spend data exists', () => {
    const status = budgetStatus(null, 100);
    expect(status.status).toBe('unknown');
    expect(status.percentUsed).toBeNull();
    expect(status.remainingKg).toBeNull();
  });
});

describe('coachNoteForPurchase', () => {
  const budget: BudgetStatus = {
    spentKg: 20,
    budgetKg: 100,
    remainingKg: 80,
    percentUsed: 20,
    status: 'within',
  };

  it('states recorded carbon as recorded', () => {
    const note = coachNoteForPurchase({
      productName: 'MacBook Air',
      carbon: recordedCarbon(185, 'A'),
      budget,
      alternativesCount: 1,
    });
    expect(note).toContain('recorded carbon footprint 185 kg CO2e');
    expect(note).not.toContain('Estimate only');
    expect(note).toContain('budget ke andar hai');
    expect(note).toContain('1 real options');
  });

  it('labels an estimate as an estimate', () => {
    const note = coachNoteForPurchase({
      productName: 'Headphones',
      carbon: estimateCarbon(25),
      budget,
      alternativesCount: 0,
    });
    expect(note).toContain('Estimate only — not a certified lifecycle assessment');
  });

  it('says plainly when there is no carbon data', () => {
    const note = coachNoteForPurchase({
      productName: 'Mystery Gadget',
      carbon: unknownCarbon,
      budget: null,
      alternativesCount: 0,
    });
    expect(note).toContain('koi carbon data recorded nahi hai');
  });

  it('warns when the budget is near or over', () => {
    const near = coachNoteForPurchase({
      productName: 'Laptop',
      carbon: recordedCarbon(185),
      budget: { spentKg: 90, budgetKg: 100, remainingKg: 10, percentUsed: 90, status: 'near' },
      alternativesCount: 0,
    });
    expect(near).toContain('90% use ho chuka hai');
    const over = coachNoteForPurchase({
      productName: 'Laptop',
      carbon: recordedCarbon(185),
      budget: { spentKg: 120, budgetKg: 100, remainingKg: -20, percentUsed: 120, status: 'over' },
      alternativesCount: 0,
    });
    expect(over).toContain('pehle hi paar ho chuka hai');
  });
});
