import { describe, expect, it } from 'vitest';
import {
  bandForRatio,
  computeEnduranceIndex,
  cyclePoints,
  modularityResult,
  recordedBandLabel,
  sustainabilityFromRecorded,
  tbwPoints,
  type HardwareEnduranceData,
} from '@/services/hardware-endurance';

function input(overrides: Partial<HardwareEnduranceData>): HardwareEnduranceData {
  return {
    thermalEfficiencyFactor: 0.85,
    ssdTbwRating: 600,
    batteryCycleCapacity: 1000,
    carbonFootprintKg: 100,
    isRamModular: true,
    isStorageModular: true,
    ...overrides,
  };
}

describe('computeEnduranceIndex', () => {
  it('scores 0.85 thermal + 600 TBW + 1000 cycles as 94 (excellent)', () => {
    const result = computeEnduranceIndex(input({}));
    expect(result.thermalPoints).toBe(34);
    expect(result.tbwPoints).toBe(30);
    expect(result.cyclePoints).toBe(30);
    expect(result.index).toBe(94);
    expect(result.band).toBe('excellent');
    expect(result.partial).toBe(false);
  });

  it('scores mid-range inputs as 60 (good)', () => {
    const result = computeEnduranceIndex(
      input({ thermalEfficiencyFactor: 0.5, ssdTbwRating: 300, batteryCycleCapacity: 800 })
    );
    expect(result.index).toBe(60);
    expect(result.band).toBe('good');
  });

  it('scores low inputs as 32 (poor)', () => {
    const result = computeEnduranceIndex(
      input({ thermalEfficiencyFactor: 0.3, ssdTbwRating: 150, batteryCycleCapacity: 500 })
    );
    expect(result.index).toBe(32);
    expect(result.band).toBe('poor');
  });

  it('returns unknown with no index when nothing is recorded', () => {
    const result = computeEnduranceIndex(
      input({
        thermalEfficiencyFactor: null,
        ssdTbwRating: null,
        batteryCycleCapacity: null,
      })
    );
    expect(result.index).toBeNull();
    expect(result.band).toBe('unknown');
    expect(result.partial).toBe(false);
  });

  it('flags a partial index as a lower bound', () => {
    const result = computeEnduranceIndex(
      input({ thermalEfficiencyFactor: 0.9, ssdTbwRating: null, batteryCycleCapacity: null })
    );
    expect(result.index).toBe(36);
    expect(result.partial).toBe(true);
    expect(result.hasThermal).toBe(true);
    expect(result.hasTbw).toBe(false);
  });

  it('rejects an out-of-range thermal factor as unrecorded', () => {
    const result = computeEnduranceIndex(
      input({ thermalEfficiencyFactor: 1.5, ssdTbwRating: null, batteryCycleCapacity: null })
    );
    expect(result.index).toBeNull();
    expect(result.band).toBe('unknown');
  });
});

describe('tbwPoints and cyclePoints', () => {
  it('maps TBW thresholds to 0/10/20/30', () => {
    expect(tbwPoints(600)).toBe(30);
    expect(tbwPoints(599)).toBe(20);
    expect(tbwPoints(300)).toBe(20);
    expect(tbwPoints(299)).toBe(10);
    expect(tbwPoints(150)).toBe(10);
    expect(tbwPoints(149)).toBe(0);
    expect(tbwPoints(null)).toBe(0);
  });

  it('maps battery-cycle thresholds to 0/10/20/30', () => {
    expect(cyclePoints(1000)).toBe(30);
    expect(cyclePoints(999)).toBe(20);
    expect(cyclePoints(800)).toBe(20);
    expect(cyclePoints(799)).toBe(10);
    expect(cyclePoints(500)).toBe(10);
    expect(cyclePoints(499)).toBe(0);
  });
});

describe('sustainabilityFromRecorded', () => {
  it('ranks 100 kg for a laptop (base 250) as A+ recorded', () => {
    const result = sustainabilityFromRecorded({
      carbonFootprintKg: 100,
      category: 'Laptops',
    });
    expect(result.status).toBe('recorded');
    expect(result.ratio).toBe(0.4);
    expect(result.band).toBe('A+');
    expect(result.categoryBaseKg).toBe(250);
  });

  it('ranks 250 kg for a laptop as B recorded', () => {
    const result = sustainabilityFromRecorded({
      carbonFootprintKg: 250,
      category: 'Laptops',
    });
    expect(result.status).toBe('recorded');
    expect(result.band).toBe('B');
  });

  it('returns unknown without a recorded value, but still shows a recorded value with no baseline', () => {
    expect(
      sustainabilityFromRecorded({ carbonFootprintKg: null, category: 'Laptops' })
    ).toEqual({ status: 'unknown', kgCO2e: null, band: null, categoryBaseKg: null, ratio: null });
    const noBaseline = sustainabilityFromRecorded({
      carbonFootprintKg: 100,
      category: 'Toasters',
    });
    expect(noBaseline.status).toBe('recorded');
    expect(noBaseline.kgCO2e).toBe(100);
    expect(noBaseline.band).toBeNull();
    expect(noBaseline.categoryBaseKg).toBeNull();
  });

  it('labels recorded bands as recorded, never estimated', () => {
    expect(recordedBandLabel('A+')).toContain('recorded');
    expect(bandForRatio(1.5)).toBe('D');
    expect(bandForRatio(2)).toBe('E');
  });
});

describe('modularityResult', () => {
  it('labels all four boolean combinations', () => {
    expect(
      modularityResult(input({ isRamModular: true, isStorageModular: true })).label
    ).toBe('Fully modular');
    expect(
      modularityResult(input({ isRamModular: true, isStorageModular: false })).label
    ).toBe('Partially modular');
    expect(
      modularityResult(input({ isRamModular: false, isStorageModular: false })).label
    ).toBe('Sealed — not upgradeable');
    expect(
      modularityResult(input({ isRamModular: null, isStorageModular: null })).label
    ).toBe('Not recorded');
  });

  it('reports a single known modular part as partial with the other unrecorded', () => {
    const result = modularityResult(input({ isRamModular: true, isStorageModular: null }));
    expect(result.label).toBe('Partially modular');
    expect(result.ram).toBe('Modular');
    expect(result.storage).toBe('Not recorded');
  });
});
