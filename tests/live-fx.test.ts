import { describe, expect, it } from 'vitest';
import {
  formatPriceForRegionWithRates,
  type LiveFxRates,
  type Region,
} from '@/lib/region';
import { formatFxShortLabel, formatFxStatus } from '@/lib/fx-status';

const PK: Region = {
  code: 'PK',
  name: 'Pakistan',
  currency: 'PKR',
  amazonDomain: 'amazon.com',
  locale: 'en-PK',
  suggestedLanguage: 'ur',
};
const US: Region = {
  code: 'US',
  name: 'United States',
  currency: 'USD',
  amazonDomain: 'amazon.com',
  locale: 'en-US',
  suggestedLanguage: 'en',
};
const DE: Region = {
  code: 'DE',
  name: 'Germany',
  currency: 'EUR',
  amazonDomain: 'amazon.de',
  locale: 'de-DE',
  suggestedLanguage: 'de',
};

/** Digits only, so locale grouping separators cannot fail the test. */
function digits(display: string): string {
  return display.replace(/\D/g, '');
}

describe('formatPriceForRegionWithRates (live daily FX)', () => {
  const livePkr: LiveFxRates = {
    rates: { PKR: 278.5, EUR: 0.92 },
    source: 'live',
    fetchedAt: '2026-11-10T00:00:00Z',
  };

  it('converts with the live rate when one exists', () => {
    // 999 × 278.5 = 278,221.5 → Rs 278,222 (PKR shows 0 decimals).
    const out = formatPriceForRegionWithRates(999, PK, livePkr);
    expect(out.approximate).toBe(true);
    expect(out.source).toBe('live');
    expect(out.rateDate).toBe('2026-11-10T00:00:00Z');
    expect(digits(out.display)).toBe('278222');
  });

  it('converts EUR with the live rate', () => {
    // 100 × 0.92 = €92.00.
    const out = formatPriceForRegionWithRates(100, DE, livePkr);
    expect(out.approximate).toBe(true);
    expect(out.source).toBe('live');
    expect(digits(out.display)).toBe('9200');
  });

  it('falls back to the static table when the live rate is missing', () => {
    // Static PKR rate is 1/280 USD per rupee: 999 / (1/280) = 279,720.
    const out = formatPriceForRegionWithRates(
      999,
      PK,
      { rates: { EUR: 0.92 }, source: 'live', fetchedAt: '2026-11-10T00:00:00Z' }
    );
    expect(out.approximate).toBe(true);
    expect(out.source).toBe('static');
    expect(out.rateDate).toBeNull();
    expect(digits(out.display)).toBe('279720');
  });

  it('falls back to the static table when there are no live rates at all', () => {
    const out = formatPriceForRegionWithRates(999, PK, null);
    expect(out.source).toBe('static');
    expect(out.rateDate).toBeNull();
    expect(digits(out.display)).toBe('279720');
  });

  it('falls back to the static table on a bad live rate', () => {
    const out = formatPriceForRegionWithRates(999, PK, {
      rates: { PKR: 0 },
      source: 'live',
      fetchedAt: '2026-11-10T00:00:00Z',
    });
    expect(out.source).toBe('static');
    expect(digits(out.display)).toBe('279720');
  });

  it('never converts USD, live rates or not', () => {
    const out = formatPriceForRegionWithRates(999, US, livePkr);
    expect(out.approximate).toBe(false);
    expect(out.display).toBe('$999.00');
  });
});

describe('formatFxStatus (honest wording — never "real-time")', () => {
  it('labels a live rate with its feed date', () => {
    const line = formatFxStatus(
      { source: 'live', fetchedAt: '2026-11-10T00:00:00Z' },
      false
    );
    expect(line).toContain('live daily rate');
    expect(line).toContain('last updated');
    expect(line).not.toContain('real-time');
    expect(line).not.toContain('real time');
  });

  it('says so when the live feed reports no time', () => {
    const line = formatFxStatus({ source: 'live', fetchedAt: null }, false);
    expect(line).toContain('live daily rate');
    expect(line).toContain('not reported');
  });

  it('labels the static fallback as approximate', () => {
    const line = formatFxStatus({ source: 'static', fetchedAt: null }, false);
    expect(line).toContain('static fallback');
    expect(line).toContain('≈');
  });

  it('labels a failed fetch as the static fallback', () => {
    const line = formatFxStatus(null, true);
    expect(line).toContain('static fallback');
  });

  it('says loading while the fetch is in flight', () => {
    const line = formatFxStatus(null, false);
    expect(line).toContain('loading');
  });
});

describe('formatFxShortLabel (inline price note)', () => {
  it('shows the live rate date', () => {
    const label = formatFxShortLabel(
      { source: 'live', fetchedAt: '2026-11-10T00:00:00Z' },
      false
    );
    expect(label).toContain('live daily rate');
    expect(label).toContain('2026');
    expect(label).not.toContain('real-time');
  });

  it('shows a bare live label without a feed date', () => {
    expect(formatFxShortLabel({ source: 'live', fetchedAt: null }, false)).toBe(
      'live daily rate'
    );
  });

  it('shows the static label on fallback or failure', () => {
    expect(formatFxShortLabel({ source: 'static', fetchedAt: null }, false)).toBe(
      'approx. static rate'
    );
    expect(formatFxShortLabel(null, true)).toBe('approx. static rate');
  });

  it('shows nothing while loading', () => {
    expect(formatFxShortLabel(null, false)).toBeNull();
  });
});
