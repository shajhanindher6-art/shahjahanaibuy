import { describe, expect, it } from 'vitest';
import { calculateLandedCost, parseLandedCostParams } from '@/lib/landed-cost';

describe('calculateLandedCost', () => {
  it('$999 + $25 shipping, 10% duty, 18% VAT → $1,329.15', () => {
    const result = calculateLandedCost({
      price: 999,
      shipping: 25,
      dutyPercent: 10,
      vatPercent: 18,
      country: 'Pakistan',
    });
    expect(result?.dutiableBase).toBe(1024);
    expect(result?.duty).toBe(102.4);
    expect(result?.taxableBase).toBe(1126.4);
    expect(result?.vat).toBe(202.75);
    expect(result?.total).toBe(1329.15);
    expect(result?.upliftPercent).toBeCloseTo(33.0, 1);
  });

  it('zero rates return price + shipping only', () => {
    const result = calculateLandedCost({
      price: 100,
      shipping: 0,
      dutyPercent: 0,
      vatPercent: 0,
      country: 'Pakistan',
    });
    expect(result?.total).toBe(100);
    expect(result?.upliftPercent).toBe(0);
  });

  it('duty applies to price + shipping, VAT to price + shipping + duty', () => {
    const result = calculateLandedCost({
      price: 100,
      shipping: 100,
      dutyPercent: 50,
      vatPercent: 100,
      country: 'Testland',
    });
    // Dutiable base 200 → duty 100 → taxable 300 → VAT 300 → total 600.
    expect(result?.duty).toBe(100);
    expect(result?.vat).toBe(300);
    expect(result?.total).toBe(600);
  });

  it('trims the country and keeps it in the result', () => {
    const result = calculateLandedCost({
      price: 10,
      shipping: 0,
      dutyPercent: 0,
      vatPercent: 0,
      country: '  Pakistan  ',
    });
    expect(result?.country).toBe('Pakistan');
  });

  it('rejects invalid inputs', () => {
    const base = {
      price: 100,
      shipping: 0,
      dutyPercent: 0,
      vatPercent: 0,
      country: 'Pakistan',
    };
    expect(calculateLandedCost({ ...base, price: 0 })).toBeNull();
    expect(calculateLandedCost({ ...base, price: -1 })).toBeNull();
    expect(calculateLandedCost({ ...base, shipping: -1 })).toBeNull();
    expect(calculateLandedCost({ ...base, dutyPercent: -1 })).toBeNull();
    expect(calculateLandedCost({ ...base, dutyPercent: 101 })).toBeNull();
    expect(calculateLandedCost({ ...base, vatPercent: 101 })).toBeNull();
    expect(calculateLandedCost({ ...base, country: '   ' })).toBeNull();
    expect(calculateLandedCost({ ...base, country: '' })).toBeNull();
  });
});

describe('parseLandedCostParams', () => {
  it('parses a full query', () => {
    const { input, errors, hasQuery } = parseLandedCostParams({
      price: '999',
      country: 'Pakistan',
      shipping: '25',
      duty: '10',
      vat: '18',
    });
    expect(hasQuery).toBe(true);
    expect(errors).toEqual([]);
    expect(input).toEqual({
      price: 999,
      shipping: 25,
      dutyPercent: 10,
      vatPercent: 18,
      country: 'Pakistan',
    });
  });

  it('missing shipping/duty/vat default to 0, not to a preset rate', () => {
    const { input, errors } = parseLandedCostParams({
      price: '100',
      country: 'Pakistan',
    });
    expect(errors).toEqual([]);
    expect(input?.shipping).toBe(0);
    expect(input?.dutyPercent).toBe(0);
    expect(input?.vatPercent).toBe(0);
  });

  it('empty params give no input and no errors', () => {
    const { input, errors, hasQuery } = parseLandedCostParams({});
    expect(hasQuery).toBe(false);
    expect(input).toBeNull();
    expect(errors).toEqual([]);
  });

  it('a query without a price errors', () => {
    const { input, errors } = parseLandedCostParams({ country: 'Pakistan' });
    expect(input).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toMatch(/price/);
  });

  it('a duty rate above 100% errors', () => {
    const { input, errors } = parseLandedCostParams({
      price: '100',
      country: 'Pakistan',
      duty: '150',
    });
    expect(input).toBeNull();
    expect(errors.join(' ')).toMatch(/Duty rate/);
  });
});
