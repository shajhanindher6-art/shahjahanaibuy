import { describe, expect, it } from 'vitest';
import {
  availabilityLabelForYears,
  computeRepairabilityIndex,
  type RepairabilityData,
} from '@/services/repairability';

function input(overrides: Partial<RepairabilityData>): RepairabilityData {
  return {
    repairabilityScore: 7.0,
    sparePartsYears: 10,
    localRepairRiskLevel: 'Low',
    ...overrides,
  };
}

describe('computeRepairabilityIndex', () => {
  it('scores 7.0 with 10 parts years as 76 (excellent)', () => {
    const result = computeRepairabilityIndex(input({}));
    expect(result.index).toBe(76);
    expect(result.verdict).toBe('excellent');
  });

  it('caps the index at 100', () => {
    const result = computeRepairabilityIndex(
      input({ repairabilityScore: 10, sparePartsYears: 10 })
    );
    expect(result.index).toBe(100);
  });

  it('counts unrecorded spare-parts years as 0 and flags it', () => {
    const result = computeRepairabilityIndex(input({ sparePartsYears: null }));
    expect(result.index).toBe(56);
    expect(result.hasPartsYears).toBe(false);
    expect(result.verdict).toBe('good');
  });

  it('returns unknown with no index when no score is recorded', () => {
    const result = computeRepairabilityIndex(
      input({ repairabilityScore: null, sparePartsYears: 10, localRepairRiskLevel: 'Low' })
    );
    expect(result.index).toBeNull();
    expect(result.verdict).toBe('unknown');
  });

  it('flags an index below 40 as not-recommended', () => {
    const result = computeRepairabilityIndex(
      input({ repairabilityScore: 3, sparePartsYears: 2 })
    );
    expect(result.index).toBe(28);
    expect(result.verdict).toBe('not-recommended');
  });

  it('flags High local repair risk as not-recommended even with a high index', () => {
    const result = computeRepairabilityIndex(
      input({ repairabilityScore: 9, sparePartsYears: 10, localRepairRiskLevel: 'High' })
    );
    expect(result.index).toBe(92);
    expect(result.verdict).toBe('not-recommended');
  });

  it('rejects an out-of-range score as unrecorded', () => {
    const result = computeRepairabilityIndex(input({ repairabilityScore: 42 }));
    expect(result.index).toBeNull();
    expect(result.verdict).toBe('unknown');
  });
});

describe('availabilityLabelForYears', () => {
  it('derives High/Medium/Low/Not recorded from years', () => {
    expect(availabilityLabelForYears(10)).toBe('High');
    expect(availabilityLabelForYears(7)).toBe('High');
    expect(availabilityLabelForYears(5)).toBe('Medium');
    expect(availabilityLabelForYears(2)).toBe('Low');
    expect(availabilityLabelForYears(null)).toBe('Not recorded');
  });
});

// ---------------------------------------------------------------------------
// T7 — AI Repairability Explorer (/tools/repairability) page contract.
// The page renders computeRepairabilityIndex per catalog product and
// shows "Not recorded yet" for every product without data. Today
// migration 019 is not applied, so every product is all-null: the
// page must be an honest empty state + explainer, never a score.
// These tests pin the contract the page relies on.
// ---------------------------------------------------------------------------

describe('repairability explorer honest empty state', () => {
  const noData: RepairabilityData = {
    repairabilityScore: null,
    sparePartsYears: null,
    localRepairRiskLevel: null,
  };

  it('gives a product with no recorded data NO index at all', () => {
    const result = computeRepairabilityIndex(noData);
    expect(result.index).toBeNull();
    expect(result.verdict).toBe('unknown');
    expect(result.hasScore).toBe(false);
    expect(result.hasPartsYears).toBe(false);
    expect(result.hasRisk).toBe(false);
    expect(result.availabilityLabel).toBe('Not recorded');
  });

  it('keeps an unrecorded score unrecorded even with parts years present', () => {
    const result = computeRepairabilityIndex({
      ...noData,
      sparePartsYears: 10,
    });
    expect(result.index).toBeNull();
    expect(result.verdict).toBe('unknown');
    // Parts availability is still derivable from the years alone.
    expect(result.availabilityLabel).toBe('High');
  });

  it('draws the verdict bands the explainer documents', () => {
    // 70+ is excellent, 40–69 is good, below 40 not-recommended.
    expect(
      computeRepairabilityIndex({
        repairabilityScore: 8,
        sparePartsYears: 3,
        localRepairRiskLevel: 'Low',
      }).verdict
    ).toBe('excellent'); // 8*8 + 3*2 = 70
    expect(
      computeRepairabilityIndex({
        repairabilityScore: 5,
        sparePartsYears: 0,
        localRepairRiskLevel: 'Low',
      }).verdict
    ).toBe('good'); // 5*8 = 40
    expect(
      computeRepairabilityIndex({
        repairabilityScore: 4,
        sparePartsYears: 0,
        localRepairRiskLevel: 'Low',
      }).verdict
    ).toBe('not-recommended'); // 4*8 = 32
  });
});
