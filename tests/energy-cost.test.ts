import { describe, expect, it } from 'vitest';
import {
  calculateEnergyCost,
  ENERGY_COST_BASIS_LABEL,
  parseEnergyCostParams,
} from '@/lib/energy-cost';

describe('calculateEnergyCost', () => {
  it('100W × 8h/day × $0.15/kWh = 292 kWh/year, $43.80/year, $219.00 over 5 years', () => {
    const result = calculateEnergyCost(100, 8, 0.15);
    expect(result).not.toBeNull();
    expect(result?.annualKwh).toBe(292);
    expect(result?.annualCost).toBe(43.8);
    expect(result?.fiveYearCost).toBe(219);
    expect(result?.monthlyCost).toBe(3.65);
    expect(result?.dailyCost).toBe(0.12);
  });

  it('a 1500W heater at 4h/day and $0.20/kWh costs $438/year', () => {
    const result = calculateEnergyCost(1500, 4, 0.2);
    expect(result?.annualKwh).toBe(2190);
    expect(result?.annualCost).toBe(438);
    expect(result?.fiveYearCost).toBe(2190);
  });

  it('labels the result as based on the watts and tariff entered', () => {
    expect(ENERGY_COST_BASIS_LABEL).toBe(
      'based on the watts and tariff you entered'
    );
  });

  it('rejects zero/negative watts, hours outside 0–24, and a zero or negative tariff', () => {
    expect(calculateEnergyCost(0, 8, 0.15)).toBeNull();
    expect(calculateEnergyCost(-50, 8, 0.15)).toBeNull();
    expect(calculateEnergyCost(100, 0, 0.15)).toBeNull();
    expect(calculateEnergyCost(100, 25, 0.15)).toBeNull();
    expect(calculateEnergyCost(100, 8, 0)).toBeNull();
    expect(calculateEnergyCost(100, 8, -0.1)).toBeNull();
  });

  it('rejects non-finite inputs and absurd wattage', () => {
    expect(calculateEnergyCost(Number.NaN, 8, 0.15)).toBeNull();
    expect(calculateEnergyCost(200_000, 8, 0.15)).toBeNull();
  });
});

describe('parseEnergyCostParams', () => {
  it('parses a full query', () => {
    const parsed = parseEnergyCostParams({
      watts: '100',
      hours: '8',
      tariff: '0.15',
      product: 'sony-wh-1000xm5',
    });
    expect(parsed.watts).toBe(100);
    expect(parsed.hoursPerDay).toBe(8);
    expect(parsed.tariffPerKwh).toBe(0.15);
    expect(parsed.productSlug).toBe('sony-wh-1000xm5');
    expect(parsed.wattsError).toBeNull();
    expect(parsed.hoursError).toBeNull();
    expect(parsed.tariffError).toBeNull();
  });

  it('never defaults the tariff: an empty tariff stays null with a prompt, not a number', () => {
    const parsed = parseEnergyCostParams({
      watts: '100',
      hours: '8',
      tariff: '',
    });
    expect(parsed.tariffPerKwh).toBeNull();
    expect(parsed.tariffError).toContain('Enter your electricity tariff');
    expect(parsed.tariffError).toContain('no default tariff');
  });

  it('an absent tariff is also null, with no error until the form is submitted', () => {
    const parsed = parseEnergyCostParams({ watts: '100', hours: '8' });
    expect(parsed.tariffPerKwh).toBeNull();
    expect(parsed.tariffError).toBeNull();
  });

  it('flags hours above 24 and a non-positive tariff', () => {
    const parsed = parseEnergyCostParams({
      watts: '100',
      hours: '30',
      tariff: '0',
    });
    expect(parsed.hoursPerDay).toBeNull();
    expect(parsed.hoursError).toContain('between 0 and 24');
    expect(parsed.tariffPerKwh).toBeNull();
    expect(parsed.tariffError).toContain('not a valid tariff');
  });
});
