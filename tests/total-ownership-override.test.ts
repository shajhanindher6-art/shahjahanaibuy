/**
 * Tests for the recorded mandatory-accessories line in total
 * ownership (Option 19). The recorded cost is a separate line in
 * the total; without it the totals are exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { computeTotalOwnership } from '@/services/total-ownership';

describe('computeTotalOwnership with mandatory accessories (Option 19)', () => {
  it('adds a recorded mandatory cost as its own line in the total', () => {
    const r = computeTotalOwnership({
      basePriceUsd: 999,
      accessoriesUsd: 0,
      warrantyUsd: 0,
      maintenanceUsd: 0,
      mandatoryAccessoriesUsd: 50,
    });
    expect(r.mandatoryAccessoriesUsd).toBe(50);
    expect(r.extrasUsd).toBe(50);
    expect(r.totalUsd).toBe(1049);
    expect(r.extrasSharePct).toBe(5);
  });

  it('adds mandatory on top of the shopper’s own extras', () => {
    const r = computeTotalOwnership({
      basePriceUsd: 999,
      accessoriesUsd: 100,
      warrantyUsd: 0,
      maintenanceUsd: 0,
      mandatoryAccessoriesUsd: 50,
    });
    expect(r.extrasUsd).toBe(150);
    expect(r.totalUsd).toBe(1149);
  });

  it('without a recorded cost the totals are exactly as before', () => {
    const r = computeTotalOwnership({
      basePriceUsd: 999,
      accessoriesUsd: 100,
      warrantyUsd: 50,
      maintenanceUsd: 25,
    });
    expect(r.mandatoryAccessoriesUsd).toBe(0);
    expect(r.extrasUsd).toBe(175);
    expect(r.totalUsd).toBe(1174);
  });

  it('sanitizes a negative mandatory cost to 0', () => {
    const r = computeTotalOwnership({
      basePriceUsd: 999,
      accessoriesUsd: 0,
      warrantyUsd: 0,
      maintenanceUsd: 0,
      mandatoryAccessoriesUsd: -20,
    });
    expect(r.mandatoryAccessoriesUsd).toBe(0);
    expect(r.totalUsd).toBe(999);
  });
});
