import { describe, expect, it } from 'vitest';
import {
  convertCurrency,
  formatConvertedAmount,
  isCurrencyCode,
  parseConverterParams,
  RATES_NOTE,
  SUPPORTED_CURRENCIES,
} from '@/lib/currency-converter';

describe('convertCurrency', () => {
  it('covers 51 currencies, USD first', () => {
    expect(SUPPORTED_CURRENCIES).toHaveLength(51);
    expect(SUPPORTED_CURRENCIES[0]).toBe('USD');
    expect(SUPPORTED_CURRENCIES).toContain('PKR');
    expect(SUPPORTED_CURRENCIES).toContain('EUR');
    expect(SUPPORTED_CURRENCIES).toContain('JPY');
  });

  it('$999 → PKR uses the static ≈280 rate', () => {
    const result = convertCurrency(999, 'USD', 'PKR');
    expect(result).not.toBeNull();
    expect(result?.converted).toBe(279720);
    expect(result?.usdValue).toBe(999);
  });

  it('PKR → USD inverts the same rate', () => {
    const result = convertCurrency(28000, 'PKR', 'USD');
    expect(result?.converted).toBe(100);
  });

  it('EUR → GBP goes via USD (1 EUR ≈ $1.08, 1 GBP ≈ $1.27)', () => {
    const result = convertCurrency(100, 'EUR', 'GBP');
    expect(result?.converted).toBeCloseTo(85.04, 2);
    expect(result?.usdValue).toBe(108);
  });

  it('same currency returns the amount unchanged', () => {
    expect(convertCurrency(50, 'PKR', 'PKR')?.converted).toBe(50);
  });

  it('rejects non-positive amounts and unknown codes', () => {
    expect(convertCurrency(0, 'USD', 'PKR')).toBeNull();
    expect(convertCurrency(-5, 'USD', 'PKR')).toBeNull();
    expect(convertCurrency(10, 'XXX' as never, 'PKR')).toBeNull();
  });

  it('labels rates as approximate static rates, never live', () => {
    expect(RATES_NOTE).toMatch(/Approximate static rates/);
    expect(RATES_NOTE).toMatch(/2026-11-01\/02/);
    expect(RATES_NOTE).toMatch(/not live rates/);
  });
});

describe('isCurrencyCode + parseConverterParams', () => {
  it('accepts codes case-insensitively, rejects unknown ones', () => {
    expect(isCurrencyCode('pkr')).toBe(true);
    expect(isCurrencyCode('XXX')).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
  });

  it('parses ?amount=&from=&to=, defaulting to USD → PKR', () => {
    const parsed = parseConverterParams({ amount: '999', from: 'USD', to: 'PKR' });
    expect(parsed.amount).toBe(999);
    expect(parsed.from).toBe('USD');
    expect(parsed.to).toBe('PKR');
    expect(parsed.amountError).toBeNull();
  });

  it('defaults from/to when absent or unknown; invalid amount is reported', () => {
    const parsed = parseConverterParams({ amount: 'abc', from: 'XXX' });
    expect(parsed.amount).toBeNull();
    expect(parsed.amountError).toMatch(/not a valid amount/);
    expect(parsed.from).toBe('USD');
    expect(parsed.to).toBe('PKR');
  });
});

describe('formatConvertedAmount', () => {
  it('formats with the currency code', () => {
    expect(formatConvertedAmount(279720, 'PKR')).toContain('279,720');
    expect(formatConvertedAmount(100, 'USD')).toBe('$100.00');
  });
});
