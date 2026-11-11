/**
 * Unit tests for did-you-mean / typo correction (Section 14, Chunk 4
 * — B5). Pure functions over a small catalog token set mirroring the
 * live 10-product catalog (MacBook Air 13, Galaxy S24 Ultra, Sony
 * WH-1000XM5, Dell XPS 13, Lenovo ThinkPad X1, Bose QuietComfort
 * Ultra, Canon EOS R10, GoPro, Garmin, Logitech).
 */

import { describe, expect, it } from 'vitest';
import {
  correctToken,
  catalogTokenSet,
  fallbackAutocompleteToken,
  levenshteinDistance,
  suggestSearchCorrection,
  type SearchCatalogTokens,
} from '@/lib/search-suggestions';

const CATALOG: SearchCatalogTokens = {
  names: [
    'MacBook Air 13',
    'Galaxy S24 Ultra',
    'Sony WH-1000XM5',
    'Dell XPS 13',
    'Lenovo ThinkPad X1',
    'Bose QuietComfort Ultra',
    'Canon EOS R10',
    'GoPro Hero 12',
    'Garmin Forerunner 965',
    'Logitech MX Master 3S',
  ],
  brands: ['Apple', 'Samsung', 'Sony', 'Dell', 'Lenovo', 'Bose', 'Canon', 'GoPro', 'Garmin', 'Logitech'],
  categories: ['laptop', 'phone', 'headphones', 'camera', 'watch', 'mouse'],
};

describe('levenshteinDistance', () => {
  it('is 0 for identical words and 1 for a single typo', () => {
    expect(levenshteinDistance('macbook', 'macbook')).toBe(0);
    expect(levenshteinDistance('macbok', 'macbook')).toBe(1);
    expect(levenshteinDistance('laptp', 'laptop')).toBe(1);
  });

  it('counts a transposition as 2 edits (no special-case)', () => {
    expect(levenshteinDistance('macbook', 'macobok')).toBe(2);
  });

  it('early-exits above the max distance', () => {
    expect(levenshteinDistance('toaster', 'macbook', 2)).toBeGreaterThan(2);
  });
});

describe('catalogTokenSet', () => {
  it('collects name words, brands and categories, lower-cased', () => {
    const tokens = catalogTokenSet(CATALOG);
    for (const word of ['macbook', 'air', 'galaxy', 'ultra', 'apple', 'samsung', 'laptop', 'headphones', 'xps', 'thinkpad']) {
      expect(tokens.has(word)).toBe(true);
    }
    // Model fragments shorter than 3 letters are not tokens.
    expect(tokens.has('wh')).toBe(false);
    expect(tokens.has('x1')).toBe(false);
  });
});

describe('correctToken', () => {
  const tokens = catalogTokenSet(CATALOG);

  it('corrects a one-letter typo in a brand or product word', () => {
    expect(correctToken('macbok', tokens)).toBe('macbook');
    expect(correctToken('samsng', tokens)).toBe('samsung');
    expect(correctToken('laptp', tokens)).toBe('laptop');
  });

  it('corrects a transposition (two edits, same prefix)', () => {
    expect(correctToken('macobok', tokens)).toBe('macbook');
    expect(correctToken('macboook', tokens)).toBe('macbook');
    // A 2-edit correction on a 4-letter word would match anything.
    expect(correctToken('lapt', tokens)).toBeNull();
  });

  it('returns null for exact catalog words, stopwords and numbers', () => {
    expect(correctToken('macbook', tokens)).toBeNull();
    expect(correctToken('laptop', tokens)).toBeNull();
    expect(correctToken('best', tokens)).toBeNull();
    expect(correctToken('under', tokens)).toBeNull();
    expect(correctToken('13', tokens)).toBeNull();
    expect(correctToken('ab', tokens)).toBeNull();
  });

  it('returns null for gibberish far from every catalog token', () => {
    expect(correctToken('toaster', tokens)).toBeNull();
    expect(correctToken('zzzzzz', tokens)).toBeNull();
  });
});

describe('suggestSearchCorrection', () => {
  it('corrects a mistyped product word, keeping the rest of the query', () => {
    expect(suggestSearchCorrection('macbok air 13', CATALOG)).toBe('macbook air 13');
    expect(suggestSearchCorrection('samsng phone', CATALOG)).toBe('samsung phone');
    expect(suggestSearchCorrection('laptp under $1000', CATALOG)).toBe('laptop under $1000');
  });

  it('corrects several mistyped words in one query', () => {
    expect(suggestSearchCorrection('macbok laptp', CATALOG)).toBe('macbook laptop');
  });

  it('returns null when the query needs no correction', () => {
    expect(suggestSearchCorrection('macbook air 13', CATALOG)).toBeNull();
    expect(suggestSearchCorrection('best laptop under $1000', CATALOG)).toBeNull();
    expect(suggestSearchCorrection('laptop', CATALOG)).toBeNull();
  });

  it('returns null for gibberish and for an empty catalog', () => {
    expect(suggestSearchCorrection('toaster oven', CATALOG)).toBeNull();
    expect(suggestSearchCorrection('macbok', { names: [], brands: [], categories: [] })).toBeNull();
    expect(suggestSearchCorrection('   ', CATALOG)).toBeNull();
  });

  it('never corrects numbers, model tokens or punctuation', () => {
    expect(suggestSearchCorrection('sony wh-1000xm5', CATALOG)).toBeNull();
    expect(suggestSearchCorrection('macbook,', CATALOG)).toBeNull();
  });

  it('is case-insensitive and returns a lower-case suggestion', () => {
    expect(suggestSearchCorrection('MacBok Air', CATALOG)).toBe('macbook Air');
  });
});

describe('fallbackAutocompleteToken', () => {
  it('returns the longest word of a multi-word query', () => {
    expect(fallbackAutocompleteToken('macbook 13')).toBe('macbook');
    expect(fallbackAutocompleteToken('sony headphones')).toBe('headphones');
    expect(fallbackAutocompleteToken('dell xps 13')).toBe('dell');
  });

  it('returns null for a single token or only-short tokens', () => {
    expect(fallbackAutocompleteToken('macbook')).toBeNull();
    expect(fallbackAutocompleteToken('13')).toBeNull();
    expect(fallbackAutocompleteToken('a b')).toBeNull();
  });
});
