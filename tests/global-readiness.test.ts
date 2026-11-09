/**
 * Tests for the global-readiness engine (Option 20).
 * Pure logic + sanitization — no DB, no network. The fail-safe DB
 * read is covered by the same pattern as repairability/endurance/
 * physical/recorded (all nulls on error).
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeRegionalAvailability,
  sanitizeNextGenMonths,
  sanitizeWarrantyType,
  warrantyLabel,
  availabilitySummary,
  nextGenSignal,
  NEXT_GEN_WAIT_THRESHOLD_MONTHS,
} from '@/services/global-readiness';

describe('sanitizeRegionalAvailability', () => {
  it('accepts a recorded map of region codes to booleans', () => {
    expect(sanitizeRegionalAvailability({ US: true, PK: false })).toEqual({
      US: true,
      PK: false,
    });
  });

  it('normalizes keys to uppercase and trims them', () => {
    expect(sanitizeRegionalAvailability({ ' us ': true, eu: true })).toEqual({
      US: true,
      EU: true,
    });
  });

  it('accepts a JSON string of a map', () => {
    expect(sanitizeRegionalAvailability('{"US": true, "GB": true}')).toEqual({
      US: true,
      GB: true,
    });
  });

  it('drops non-boolean entries and returns null when none remain', () => {
    expect(sanitizeRegionalAvailability({ US: 'yes', PK: 1 })).toBeNull();
    expect(sanitizeRegionalAvailability({ US: true, PK: 'yes' })).toEqual({ US: true });
  });

  it('rejects null, arrays, scalars and bad JSON', () => {
    expect(sanitizeRegionalAvailability(null)).toBeNull();
    expect(sanitizeRegionalAvailability(undefined)).toBeNull();
    expect(sanitizeRegionalAvailability(['US'])).toBeNull();
    expect(sanitizeRegionalAvailability('US')).toBeNull();
    expect(sanitizeRegionalAvailability('{bad json')).toBeNull();
    expect(sanitizeRegionalAvailability({})).toBeNull();
  });
});

describe('sanitizeNextGenMonths', () => {
  it('accepts non-negative integers, including 0', () => {
    expect(sanitizeNextGenMonths(0)).toBe(0);
    expect(sanitizeNextGenMonths(3)).toBe(3);
    expect(sanitizeNextGenMonths(24)).toBe(24);
  });

  it('accepts a numeric string', () => {
    expect(sanitizeNextGenMonths('6')).toBe(6);
  });

  it('rejects negatives, fractions and non-numeric values', () => {
    expect(sanitizeNextGenMonths(-1)).toBeNull();
    expect(sanitizeNextGenMonths(2.5)).toBeNull();
    expect(sanitizeNextGenMonths(NaN)).toBeNull();
    expect(sanitizeNextGenMonths('soon')).toBeNull();
    expect(sanitizeNextGenMonths(null)).toBeNull();
  });
});

describe('sanitizeWarrantyType / warrantyLabel', () => {
  it('trims a recorded label and caps it at the column width', () => {
    expect(sanitizeWarrantyType('  Local Manufacturer  ')).toBe('Local Manufacturer');
    expect(sanitizeWarrantyType('x'.repeat(60))).toBe('x'.repeat(50));
  });

  it('returns null for empty or non-string values', () => {
    expect(sanitizeWarrantyType('   ')).toBeNull();
    expect(sanitizeWarrantyType(null)).toBeNull();
    expect(sanitizeWarrantyType(42)).toBeNull();
  });

  it('returns "Not recorded" when nothing is recorded', () => {
    expect(warrantyLabel(null)).toBe('Not recorded');
  });

  it('canonicalizes a known label case-insensitively', () => {
    expect(warrantyLabel('local manufacturer')).toBe('Local Manufacturer');
    expect(warrantyLabel('INTERNATIONAL')).toBe('International');
  });

  it('shows any other recorded label verbatim', () => {
    expect(warrantyLabel('Manufacturer (2 years)')).toBe('Manufacturer (2 years)');
  });
});

describe('availabilitySummary', () => {
  it('reports not recorded for a null map', () => {
    const summary = availabilitySummary(null);
    expect(summary.status).toBe('not_recorded');
    expect(summary.label).toBe('Availability not recorded');
  });

  it('counts recorded available regions', () => {
    const summary = availabilitySummary({ US: true, EU: true, PK: false });
    expect(summary.status).toBe('available');
    expect(summary.availableRegions).toEqual(['US', 'EU']);
    expect(summary.unavailableRegions).toEqual(['PK']);
    expect(summary.label).toBe('Available in 2 recorded regions');
  });

  it('reports none available when every recorded region is false', () => {
    const summary = availabilitySummary({ US: false, PK: false });
    expect(summary.status).toBe('none_available');
    expect(summary.label).toBe('Not available in any recorded region');
  });
});

describe('nextGenSignal', () => {
  it('is unknown when no schedule is recorded', () => {
    const signal = nextGenSignal(null);
    expect(signal.status).toBe('unknown');
    expect(signal.label).toBe('No release schedule recorded');
  });

  it('suggests waiting at the threshold (3 months)', () => {
    const signal = nextGenSignal(NEXT_GEN_WAIT_THRESHOLD_MONTHS);
    expect(signal.status).toBe('soon');
    expect(signal.label).toContain('consider waiting');
    expect(signal.label).toContain('recorded schedule');
  });

  it('suggests waiting this month for 0 months', () => {
    const signal = nextGenSignal(0);
    expect(signal.status).toBe('soon');
    expect(signal.label).toContain('this month');
  });

  it('does not suggest waiting beyond the threshold', () => {
    const signal = nextGenSignal(12);
    expect(signal.status).toBe('later');
    expect(signal.label).toContain('12 months');
    expect(signal.label).not.toContain('consider waiting');
  });

  it('uses the singular month for 1', () => {
    expect(nextGenSignal(1).label).toContain('1 month ');
  });
});
