/**
 * Unit tests for tokenized search (Section 14, Chunk 4 — B1).
 * Pure functions: query → tokens, and tokens → per-product coverage.
 * No database, no network.
 */

import { describe, expect, it } from 'vitest';
import {
  computeTokenMatches,
  inSearchPriceBand,
  tokenizeSearchTerms,
} from '@/services/ai-search';
import { parseSearchIntent } from '@/services/ai-search';

describe('tokenizeSearchTerms', () => {
  it('splits a multi-word query into tokens', () => {
    expect(tokenizeSearchTerms('apple laptop', parseSearchIntent('apple laptop'))).toEqual([
      'apple',
      'laptop',
    ]);
    expect(tokenizeSearchTerms('MacBook Air 13', parseSearchIntent('MacBook Air 13'))).toEqual([
      'macbook',
      'air',
      '13',
    ]);
  });

  it('strips budget expressions, intent words and filler', () => {
    expect(
      tokenizeSearchTerms('best laptop under $1000', parseSearchIntent('best laptop under $1000'))
    ).toEqual(['laptop']);
    expect(
      tokenizeSearchTerms(
        'best laptop under 20K PKR',
        parseSearchIntent('best laptop under 20K PKR')
      )
    ).toEqual(['laptop']);
    expect(
      tokenizeSearchTerms(
        'laptop between $500 and $1000',
        parseSearchIntent('laptop between $500 and $1000')
      )
    ).toEqual(['laptop']);
  });

  it('strips negated phrases and vs/versus', () => {
    expect(
      tokenizeSearchTerms('laptop not Apple', parseSearchIntent('laptop not Apple'))
    ).toEqual(['laptop']);
    expect(
      tokenizeSearchTerms('MacBook vs Dell XPS', parseSearchIntent('MacBook vs Dell XPS'))
    ).toEqual(['macbook', 'dell', 'xps']);
  });

  it('keeps model tokens and attribute words, drops stopwords', () => {
    expect(
      tokenizeSearchTerms(
        'noise cancelling headphones',
        parseSearchIntent('noise cancelling headphones')
      )
    ).toEqual(['noise', 'cancelling', 'headphones']);
    expect(tokenizeSearchTerms('sony wh-1000xm5', parseSearchIntent('sony wh-1000xm5'))).toEqual([
      'sony',
      'wh',
      '1000xm5',
    ]);
  });

  it('dedupes and returns [] when nothing searchable remains', () => {
    expect(tokenizeSearchTerms('laptop laptop', parseSearchIntent('laptop laptop'))).toEqual([
      'laptop',
    ]);
    expect(tokenizeSearchTerms('best cheap', parseSearchIntent('best cheap'))).toEqual([]);
    expect(tokenizeSearchTerms('', parseSearchIntent(''))).toEqual([]);
  });
});

describe('computeTokenMatches', () => {
  const macbook = {
    name: 'MacBook Air 13',
    brand: 'Apple',
    category: 'laptops',
    description: 'Lightweight laptop with long battery life.',
  };

  it('matches tokens across name, brand, category and description', () => {
    expect(computeTokenMatches(['apple', 'laptop'], macbook)).toEqual({
      matchedTerms: ['apple', 'laptop'],
      nameMatchedTerms: [],
    });
    expect(computeTokenMatches(['macbook', 'air', '13'], macbook)).toEqual({
      matchedTerms: ['macbook', 'air', '13'],
      nameMatchedTerms: ['macbook', 'air', '13'],
    });
  });

  it('matches a singular token against a plural category ("laptop" vs "laptops")', () => {
    expect(computeTokenMatches(['laptop'], macbook).matchedTerms).toEqual(['laptop']);
  });

  it('does not match a token inside another word ("ram" in "program")', () => {
    const product = {
      name: 'Code Editor Pro',
      brand: null,
      category: 'software',
      description: 'A program for developers.',
    };
    expect(computeTokenMatches(['ram'], product).matchedTerms).toEqual([]);
  });

  it('returns no matches when no token is carried', () => {
    expect(
      computeTokenMatches(['sony', 'headphones'], macbook)
    ).toEqual({ matchedTerms: [], nameMatchedTerms: [] });
  });
});

describe('inSearchPriceBand', () => {
  it('splits prices into the three bands', () => {
    expect(inSearchPriceBand(99, 'under-100')).toBe(true);
    expect(inSearchPriceBand(100, 'under-100')).toBe(false);
    expect(inSearchPriceBand(100, '100-500')).toBe(true);
    expect(inSearchPriceBand(500, '100-500')).toBe(true);
    expect(inSearchPriceBand(501, '500-plus')).toBe(true);
    expect(inSearchPriceBand(500, '500-plus')).toBe(false);
  });
});
