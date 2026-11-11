/**
 * Unit tests for the AI search intent parser (Section 14, Chunk 2):
 * negation / exclusion (B2), price bands (B3), wired attributes
 * (B7), Roman Urdu first-turn aliases (B8), and "X vs Y" compare
 * routing (B10). Pure parsing — no database, no network.
 */

import { describe, expect, it } from 'vitest';
import {
  parseCompareQuery,
  parseNegations,
  parseSearchIntent,
  resolveComparePair,
  stripNegatedPhrases,
} from '@/services/ai-search';
import { parsePriceBandFromQuery, stripBudgetFromQuery } from '@/services/currency';

describe('B2 — negation / exclusion intent', () => {
  it('parses "laptop not Apple" into an excluded brand, never a positive one', () => {
    const intent = parseSearchIntent('laptop not Apple');
    expect(intent.category).toBe('laptop');
    expect(intent.brands).toEqual([]);
    expect(intent.excludedBrands).toEqual(['Apple']);
  });

  it('parses "phone without Samsung" and "headphones no Apple"', () => {
    expect(parseSearchIntent('phone without Samsung').excludedBrands).toEqual(['Samsung']);
    expect(parseSearchIntent('headphones no Apple').excludedBrands).toEqual(['Apple']);
    expect(parseSearchIntent('laptop except Dell').excludedBrands).toEqual(['Dell']);
  });

  it('keeps a positive brand while excluding another ("Samsung phone not Apple")', () => {
    const intent = parseSearchIntent('Samsung phone not Apple');
    expect(intent.brands).toEqual(['Samsung']);
    expect(intent.excludedBrands).toEqual(['Apple']);
  });

  it('parses "without OLED" into an excluded term, never a positive attribute', () => {
    const intent = parseSearchIntent('headphones without OLED');
    expect(intent.excludedTerms).toContain('oled');
    expect(intent.attributes).not.toHaveProperty('display');
  });

  it('parses "no 5G" and "without noise cancelling" as excluded terms', () => {
    expect(parseSearchIntent('phone no 5G').excludedTerms).toContain('5g');
    expect(parseSearchIntent('headphones without noise cancelling').excludedTerms).toContain(
      'noise cancelling'
    );
  });

  it('leaves queries without a negation untouched', () => {
    const intent = parseSearchIntent('best laptop under $1000');
    expect(intent.excludedBrands).toEqual([]);
    expect(intent.excludedTerms).toEqual([]);
  });

  it('strips negated phrases from the search terms', () => {
    const intent = parseSearchIntent('laptop not Apple');
    expect(stripNegatedPhrases('laptop not Apple', intent)).toBe('laptop');
    const intent2 = parseSearchIntent('headphones without OLED');
    expect(stripNegatedPhrases('headphones without OLED', intent2)).toBe('headphones');
  });

  it('exposes the raw negation parse for the search filter', () => {
    expect(parseNegations('laptop not apple')).toEqual({
      excludedBrands: ['Apple'],
      excludedTerms: [],
    });
    expect(parseNegations('phone without oled').excludedTerms).toContain('oled');
  });
});

describe('B3 — price-band intent', () => {
  it('parses "between $500 and $1000"', () => {
    expect(parsePriceBandFromQuery('laptop between $500 and $1000')).toEqual({
      budgetMinUsd: 500,
      budgetMaxUsd: 1000,
      budgetCurrency: 'USD',
      budgetOriginalMin: 500,
      budgetOriginalMax: 1000,
    });
  });

  it('parses "$500–$1000" dash bands (en dash and hyphen)', () => {
    expect(parsePriceBandFromQuery('laptop $500–$1000')).toEqual({
      budgetMinUsd: 500,
      budgetMaxUsd: 1000,
      budgetCurrency: 'USD',
      budgetOriginalMin: 500,
      budgetOriginalMax: 1000,
    });
    expect(parsePriceBandFromQuery('laptop $500-$1000')?.budgetMinUsd).toBe(500);
  });

  it('parses PKR bands with conversion ("between 20K and 50K PKR")', () => {
    const band = parsePriceBandFromQuery('phone between 20K and 50K PKR');
    expect(band?.budgetMinUsd).toBe(71);
    expect(band?.budgetMaxUsd).toBe(179);
    expect(band?.budgetCurrency).toBe('PKR');
    expect(band?.budgetOriginalMin).toBe(20000);
    expect(band?.budgetOriginalMax).toBe(50000);
  });

  it('normalizes reversed ends instead of rejecting them', () => {
    const band = parsePriceBandFromQuery('laptop between $1000 and $500');
    expect(band?.budgetMinUsd).toBe(500);
    expect(band?.budgetMaxUsd).toBe(1000);
  });

  it('returns null when there is no band', () => {
    expect(parsePriceBandFromQuery('laptop under $1000')).toBeNull();
    expect(parsePriceBandFromQuery('best laptop')).toBeNull();
    // A bare "500-1000" with no symbol and no "between" is not a
    // band (it could be a model number).
    expect(parsePriceBandFromQuery('laptop 500-1000')).toBeNull();
  });

  it('wires the band into parseSearchIntent as budget + budgetMin', () => {
    const intent = parseSearchIntent('laptop between $500 and $1000');
    expect(intent.budget).toBe(1000);
    expect(intent.budgetMin).toBe(500);
    // A plain max budget still leaves budgetMin null.
    const plain = parseSearchIntent('laptop under $1000');
    expect(plain.budget).toBe(1000);
    expect(plain.budgetMin).toBeNull();
  });

  it('strips band expressions from the search terms', () => {
    expect(stripBudgetFromQuery('laptop between $500 and $1000')).toBe('laptop');
    expect(stripBudgetFromQuery('laptop $500–$1000')).toBe('laptop');
    expect(stripBudgetFromQuery('phone between 20K and 50K PKR')).toBe('phone');
  });
});

describe('B7 — parsed attributes + extended keyword map', () => {
  it('parses the original five attributes', () => {
    const intent = parseSearchIntent('laptop with long battery life');
    expect(intent.attributes.battery).toBe('long');
    expect(parseSearchIntent('lightweight laptop').attributes.weight).toBe('light');
    expect(parseSearchIntent('4k tv').attributes.resolution).toBe('4k');
    expect(parseSearchIntent('oled tv').attributes.display).toBe('oled');
    expect(parseSearchIntent('waterproof camera').attributes.waterproof).toBe('true');
  });

  it('parses the new keywords: RAM, storage, screen size, noise cancelling, touchscreen, 5G, refresh rate', () => {
    expect(parseSearchIntent('laptop with 16gb ram').attributes.ram).toBe('yes');
    expect(parseSearchIntent('laptop with 512gb ssd storage').attributes.storage).toBe('yes');
    expect(parseSearchIntent('laptop with 15-inch screen size').attributes['screen-size']).toBe(
      'yes'
    );
    expect(parseSearchIntent('noise cancelling headphones').attributes['noise-cancelling']).toBe(
      'yes'
    );
    expect(parseSearchIntent('touchscreen laptop').attributes.touchscreen).toBe('yes');
    expect(parseSearchIntent('phone with 5g').attributes['5g']).toBe('yes');
    expect(parseSearchIntent('laptop 120hz refresh rate').attributes['refresh-rate']).toBe('yes');
  });

  it('does not match "ram" inside other words', () => {
    // "program" contains "ram" but must not count as the RAM attribute.
    expect(parseSearchIntent('laptop for programming').attributes).not.toHaveProperty('ram');
  });
});

describe('B8 — Roman Urdu first-turn intent aliases', () => {
  it('maps "sasta" to the cheap intent (price-led sort)', () => {
    const intent = parseSearchIntent('sasta laptop');
    expect(intent.category).toBe('laptop');
    expect(intent.intent).toBe('cheap');
  });

  it('maps "behtareen" / "sab se acha" to the best intent', () => {
    expect(parseSearchIntent('behtareen laptop').intent).toBe('best');
    expect(parseSearchIntent('sab se acha phone').intent).toBe('best');
    expect(parseSearchIntent('sabse acha laptop').intent).toBe('best');
  });

  it('maps "mehenga" to the premium intent', () => {
    expect(parseSearchIntent('mehenga laptop').intent).toBe('premium');
  });

  it('leaves English intents unchanged', () => {
    expect(parseSearchIntent('best laptop').intent).toBe('best');
    expect(parseSearchIntent('cheap phone').intent).toBe('cheap');
    expect(parseSearchIntent('laptop').intent).toBe('general');
  });
});

describe('B10 — "X vs Y" compare routing', () => {
  it('splits "MacBook vs Dell XPS" into its two sides', () => {
    expect(parseCompareQuery('MacBook vs Dell XPS')).toEqual({
      first: 'MacBook',
      second: 'Dell XPS',
    });
    expect(parseCompareQuery('compare MacBook Air 13 vs Dell XPS 13')).toEqual({
      first: 'MacBook Air 13',
      second: 'Dell XPS 13',
    });
    expect(parseCompareQuery('MacBook versus Dell XPS')).toEqual({
      first: 'MacBook',
      second: 'Dell XPS',
    });
  });

  it('returns null without a `vs` / `versus`, or with a missing side', () => {
    expect(parseCompareQuery('best laptop')).toBeNull();
    expect(parseCompareQuery('MacBook vs')).toBeNull();
    expect(parseCompareQuery('vs Dell XPS')).toBeNull();
  });

  it('exposes the compare query on the parsed intent', () => {
    expect(parseSearchIntent('MacBook vs Dell XPS').compareQuery).toEqual({
      first: 'MacBook',
      second: 'Dell XPS',
    });
    expect(parseSearchIntent('best laptop').compareQuery).toBeNull();
  });

  const rows = [
    { id: '1', name: 'MacBook Air 13', slug: 'macbook-air-13', brand: 'Apple' },
    { id: '2', name: 'Dell XPS 13', slug: 'dell-xps-13', brand: 'Dell' },
    { id: '3', name: 'Sony WH-1000XM5', slug: 'sony-wh-1000xm5', brand: 'Sony' },
  ];

  it('resolves both sides to catalog products, in query order', () => {
    expect(
      resolveComparePair(rows, { first: 'MacBook', second: 'Dell XPS' }).map((r) => r.id)
    ).toEqual(['1', '2']);
    expect(
      resolveComparePair(rows, { first: 'Dell XPS 13', second: 'MacBook Air 13' }).map(
        (r) => r.id
      )
    ).toEqual(['2', '1']);
  });

  it('returns [] when either side cannot be resolved', () => {
    expect(resolveComparePair(rows, { first: 'MacBook', second: 'Toaster 3000' })).toEqual([]);
    expect(resolveComparePair(rows, { first: 'Toaster', second: 'Dell XPS' })).toEqual([]);
    expect(resolveComparePair(rows, { first: 'MacBook', second: 'MacBook' })).toEqual([]);
  });
});

describe('parseSearchIntent — no regressions', () => {
  it('still parses a plain max budget with currency conversion', () => {
    const intent = parseSearchIntent('best laptop under 20K PKR');
    expect(intent.budget).toBe(71);
    expect(intent.budgetCurrency).toBe('PKR');
    expect(intent.budgetOriginal).toBe(20000);
    expect(intent.budgetMin).toBeNull();
    expect(intent.intent).toBe('best');
  });
});
