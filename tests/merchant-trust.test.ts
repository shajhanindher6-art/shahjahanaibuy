import { describe, expect, it } from 'vitest';
import {
  computeTrustGrade,
  returnWindowPoints,
  warrantyPoints,
  reputationPoints,
  gradeForScore,
} from '@/lib/merchant-trust';
import {
  meetsVerifiedMerchantStandards,
  isVerificationCurrent,
} from '@/lib/verified-merchants';

describe('computeTrustGrade', () => {
  it('returns NO grade when any input is missing (all NULL today)', () => {
    const result = computeTrustGrade({
      returnWindowDays: null,
      warrantyMonths: null,
      reputationScore: null,
    });
    expect(result.grade).toBeNull();
    expect(result.score).toBeNull();
    expect(result.missing).toEqual(['returnWindowDays', 'warrantyMonths', 'reputationScore']);
    expect(result.breakdown).toBeNull();
  });

  it('returns NO grade when only some inputs are recorded', () => {
    const result = computeTrustGrade({
      returnWindowDays: 30,
      warrantyMonths: 12,
      reputationScore: null,
    });
    expect(result.grade).toBeNull();
    expect(result.score).toBeNull();
    expect(result.missing).toEqual(['reputationScore']);
  });

  it('grades A for a fully strong recorded policy', () => {
    // 40 (30d returns) + 30 (24mo warranty) + 30 (5/5 reputation) = 100.
    const result = computeTrustGrade({
      returnWindowDays: 30,
      warrantyMonths: 24,
      reputationScore: 5,
    });
    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
    expect(result.missing).toEqual([]);
    expect(result.breakdown).toEqual({
      returnWindowPoints: 40,
      warrantyPoints: 30,
      reputationPoints: 30,
    });
  });

  it('grades from the recorded numbers only — no invented uplift', () => {
    // 15 (7d returns) + 10 (6mo warranty) + 12 (2/5 reputation) = 37 → D.
    const result = computeTrustGrade({
      returnWindowDays: 7,
      warrantyMonths: 6,
      reputationScore: 2,
    });
    expect(result.score).toBe(37);
    expect(result.grade).toBe('D');
  });

  it('records a 0-day return window as 0 points, not as missing', () => {
    // 0 + 20 (12mo) + 24 (4/5) = 44 → D, and nothing is "missing".
    const result = computeTrustGrade({
      returnWindowDays: 0,
      warrantyMonths: 12,
      reputationScore: 4,
    });
    expect(result.score).toBe(44);
    expect(result.grade).toBe('D');
    expect(result.missing).toEqual([]);
  });
});

describe('returnWindowPoints / warrantyPoints / reputationPoints', () => {
  it('applies the published bands', () => {
    expect(returnWindowPoints(30)).toBe(40);
    expect(returnWindowPoints(14)).toBe(30);
    expect(returnWindowPoints(7)).toBe(15);
    expect(returnWindowPoints(1)).toBe(5);
    expect(returnWindowPoints(0)).toBe(0);

    expect(warrantyPoints(24)).toBe(30);
    expect(warrantyPoints(12)).toBe(20);
    expect(warrantyPoints(6)).toBe(10);
    expect(warrantyPoints(1)).toBe(5);
    expect(warrantyPoints(0)).toBe(0);

    expect(reputationPoints(5)).toBe(30);
    expect(reputationPoints(2.5)).toBe(15);
    expect(reputationPoints(0)).toBe(0);
  });

  it('clamps reputation above 5 and below 0', () => {
    expect(reputationPoints(9)).toBe(30);
    expect(reputationPoints(-1)).toBe(0);
  });
});

describe('gradeForScore', () => {
  it('applies the A/B/C/D cutoffs', () => {
    expect(gradeForScore(100)).toBe('A');
    expect(gradeForScore(85)).toBe('A');
    expect(gradeForScore(84)).toBe('B');
    expect(gradeForScore(70)).toBe('B');
    expect(gradeForScore(69)).toBe('C');
    expect(gradeForScore(50)).toBe('C');
    expect(gradeForScore(49)).toBe('D');
    expect(gradeForScore(0)).toBe('D');
  });
});

describe('meetsVerifiedMerchantStandards', () => {
  const full = {
    accuracyScore: 98,
    auditSampleCount: 12,
    returnWindowDays: 30,
    warrantyMonths: 24,
    trustGrade: 'A' as const,
    hasPolicyUrl: true,
  };

  it('is eligible only when EVERY standard is met', () => {
    expect(meetsVerifiedMerchantStandards(full).eligible).toBe(true);
    expect(meetsVerifiedMerchantStandards(full).unmet).toEqual([]);
  });

  it('is NOT eligible with no recorded data at all (today’s state)', () => {
    const result = meetsVerifiedMerchantStandards({
      accuracyScore: null,
      auditSampleCount: 0,
      returnWindowDays: null,
      warrantyMonths: null,
      trustGrade: null,
      hasPolicyUrl: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.unmet.length).toBe(5);
  });

  it('fails on accuracy below 95%, too few samples, short returns, short warranty, low grade, and missing policy URL', () => {
    expect(meetsVerifiedMerchantStandards({ ...full, accuracyScore: 94 }).eligible).toBe(false);
    expect(meetsVerifiedMerchantStandards({ ...full, auditSampleCount: 9 }).eligible).toBe(false);
    expect(meetsVerifiedMerchantStandards({ ...full, returnWindowDays: 13 }).eligible).toBe(false);
    expect(meetsVerifiedMerchantStandards({ ...full, warrantyMonths: 11 }).eligible).toBe(false);
    expect(meetsVerifiedMerchantStandards({ ...full, trustGrade: 'C' }).eligible).toBe(false);
    expect(meetsVerifiedMerchantStandards({ ...full, hasPolicyUrl: false }).eligible).toBe(false);
  });

  it('accepts the exact minimums (95%, 10 samples, 14 days, 12 months, grade B)', () => {
    const result = meetsVerifiedMerchantStandards({
      accuracyScore: 95,
      auditSampleCount: 10,
      returnWindowDays: 14,
      warrantyMonths: 12,
      trustGrade: 'B',
      hasPolicyUrl: true,
    });
    expect(result.eligible).toBe(true);
  });
});

describe('isVerificationCurrent', () => {
  it('is false with no expiry and true only inside the window', () => {
    expect(isVerificationCurrent(null)).toBe(false);
    expect(isVerificationCurrent('2030-01-01T00:00:00.000Z')).toBe(true);
    expect(isVerificationCurrent('2020-01-01T00:00:00.000Z')).toBe(false);
  });
});
