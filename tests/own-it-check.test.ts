import { describe, expect, it } from 'vitest';
import {
  OWN_IT_FUZZY_THRESHOLD,
  OWN_IT_GTIN_CONFIDENCE,
  findOwnItMatches,
  matchOwnItSavedSearches,
  normalizeOwnItText,
  ownItNameSimilarity,
  parseOwnItCheckParams,
  type OwnItCandidate,
  type OwnItQuery,
} from '@/lib/own-it-check';

function candidate(overrides: Partial<OwnItCandidate> & { name: string }): OwnItCandidate {
  return {
    id: 'c1',
    source: 'wishlist',
    listLabel: 'Wishlist “Tech”',
    slug: null,
    brand: null,
    gtin: null,
    ...overrides,
  };
}

describe('normalizeOwnItText', () => {
  it('lower-cases and collapses non-alphanumerics (pipeline dedup pattern)', () => {
    expect(normalizeOwnItText('MacBook Air 13-inch!')).toBe('macbook air 13 inch');
    expect(normalizeOwnItText('  Sony   WH-1000XM5 ')).toBe('sony wh 1000xm5');
    expect(normalizeOwnItText('')).toBe('');
  });
});

describe('ownItNameSimilarity', () => {
  it('scores identical token sets as 1 regardless of order', () => {
    expect(ownItNameSimilarity('Air 13 MacBook', 'MacBook Air 13')).toBe(1);
  });

  it('scores distinct models below the fuzzy threshold', () => {
    // Same pattern as the pipeline's example: Air vs Pro share
    // {macbook, 13} of {macbook, air, 13, pro} = 0.5.
    expect(ownItNameSimilarity('MacBook Air 13', 'MacBook Pro 13')).toBe(0.5);
    expect(ownItNameSimilarity('MacBook Air 13', 'MacBook Pro 13')).toBeLessThan(
      OWN_IT_FUZZY_THRESHOLD
    );
  });
});

describe('findOwnItMatches — slug leg', () => {
  it('matches the same product by slug at confidence 1', () => {
    const query: OwnItQuery = { slug: 'macbook-air-13', name: 'MacBook Air 13', brand: 'Apple' };
    const matches = findOwnItMatches(query, [
      candidate({ id: 'w1', slug: 'macbook-air-13', name: 'MacBook Air 13' }),
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedBy).toBe('slug');
    expect(matches[0].confidence).toBe(1);
    expect(matches[0].exact).toBe(true);
  });

  it('does not match a different slug', () => {
    const query: OwnItQuery = { slug: 'macbook-air-13', name: 'MacBook Air 13', brand: 'Apple' };
    expect(
      findOwnItMatches(query, [
        candidate({ id: 'w1', slug: 'macbook-pro-13', name: 'MacBook Pro 13', brand: 'Apple' }),
      ])
    ).toHaveLength(0);
  });
});

describe('findOwnItMatches — GTIN leg', () => {
  it('matches by GTIN at the 0.9 cap, never 1.0', () => {
    const query: OwnItQuery = { name: 'MacBook Air 13', brand: 'Apple', gtin: '0194253161783' };
    const matches = findOwnItMatches(query, [
      candidate({ id: 'b1', source: 'buy-list', listLabel: 'Buy list', name: 'MacBook Air', gtin: '0194253161783' }),
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedBy).toBe('gtin');
    expect(matches[0].confidence).toBe(OWN_IT_GTIN_CONFIDENCE);
    expect(matches[0].confidence).toBeLessThan(1);
  });

  it('ignores GTIN formatting differences (dashes/spaces)', () => {
    const query: OwnItQuery = { name: 'Sony WH-1000XM5', gtin: '4548736130383' };
    const matches = findOwnItMatches(query, [
      candidate({ id: 'b1', name: 'Sony WH-1000XM5', gtin: '4548-7361-3038-3' }),
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedBy).toBe('gtin');
  });

  it('does not match a different GTIN', () => {
    // The name differs too: with an identical name the name-exact
    // leg would (correctly) still match — this isolates the GTIN leg.
    const query: OwnItQuery = { name: 'MacBook Air 13', gtin: '0194253161783' };
    expect(
      findOwnItMatches(query, [candidate({ name: 'MacBook Pro 13', gtin: '0194253161790' })])
    ).toHaveLength(0);
  });
});

describe('findOwnItMatches — name legs', () => {
  it('matches exact name+brand at confidence 1', () => {
    const query: OwnItQuery = { name: 'MacBook Air 13', brand: 'Apple' };
    const matches = findOwnItMatches(query, [
      candidate({ name: 'MacBook Air 13', brand: 'Apple' }),
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedBy).toBe('name-brand-exact');
    expect(matches[0].confidence).toBe(1);
    expect(matches[0].exact).toBe(true);
  });

  it('matches an exact name when the brand is unknown on one side, capped at 0.9', () => {
    // Guest lists store name only — no brand to compare.
    const query: OwnItQuery = { name: 'MacBook Air 13', brand: 'Apple' };
    const matches = findOwnItMatches(query, [candidate({ name: 'MacBook Air 13' })]);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedBy).toBe('name-exact');
    expect(matches[0].confidence).toBe(0.9);
  });

  it('matches a reworded name with the same brand as fuzzy, never exact', () => {
    const query: OwnItQuery = { name: 'MacBook Air 13-inch', brand: 'Apple' };
    const matches = findOwnItMatches(query, [
      candidate({ name: 'MacBook Air 13', brand: 'Apple' }),
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedBy).toBe('name-brand-fuzzy');
    expect(matches[0].exact).toBe(false);
    expect(matches[0].confidence).toBeGreaterThanOrEqual(OWN_IT_FUZZY_THRESHOLD);
  });

  it('does not fuzzy-match distinct models of the same brand', () => {
    const query: OwnItQuery = { name: 'MacBook Air 13', brand: 'Apple' };
    expect(
      findOwnItMatches(query, [candidate({ name: 'MacBook Pro 13', brand: 'Apple' })])
    ).toHaveLength(0);
  });

  it('does not fuzzy-match across different brands', () => {
    const query: OwnItQuery = { name: 'WH-1000XM5 Headphones', brand: 'Sony' };
    expect(
      findOwnItMatches(query, [candidate({ name: 'WH-1000XM5 Headphones', brand: 'Bose' })])
    ).toHaveLength(0);
  });

  it('matches nothing for a blank query name', () => {
    expect(
      findOwnItMatches({ name: '   ' }, [candidate({ name: 'MacBook Air 13' })])
    ).toHaveLength(0);
  });

  it('reports each candidate once, at its best leg, sorted by confidence', () => {
    const query: OwnItQuery = { slug: 'macbook-air-13', name: 'MacBook Air 13', brand: 'Apple' };
    const matches = findOwnItMatches(query, [
      candidate({ id: 'a', slug: 'macbook-air-13', name: 'MacBook Air 13', brand: 'Apple' }),
      candidate({ id: 'b', name: 'MacBook Air 13-inch', brand: 'Apple' }),
    ]);
    expect(matches).toHaveLength(2);
    expect(matches[0].candidate.id).toBe('a');
    expect(matches[0].confidence).toBe(1);
    expect(matches[1].matchedBy).toBe('name-brand-fuzzy');
  });
});

describe('matchOwnItSavedSearches', () => {
  const query: OwnItQuery = { name: 'Sony WH-1000XM5', brand: 'Sony' };

  it('matches a saved search whose every q token appears in the product text', () => {
    const matches = matchOwnItSavedSearches(query, [
      { id: 's1', name: 'Headphones watch', query: 'q=sony+headphones' },
    ]);
    // "headphones" is not in "sony wh-1000xm5 sony" — no match.
    expect(matches).toHaveLength(0);
    const hit = matchOwnItSavedSearches(query, [
      { id: 's1', name: 'Sony watch', query: 'q=sony+wh-1000xm5' },
    ]);
    expect(hit).toHaveLength(1);
    expect(hit[0].matchedQuery).toBe('sony wh-1000xm5');
  });

  it('does not match a search with no q (filter-only save)', () => {
    expect(
      matchOwnItSavedSearches(query, [{ id: 's1', name: 'Cheap', query: 'sort=price-asc' }])
    ).toHaveLength(0);
    expect(
      matchOwnItSavedSearches(query, [{ id: 's1', name: 'Empty', query: '' }])
    ).toHaveLength(0);
  });
});

describe('parseOwnItCheckParams', () => {
  it('parses a catalog product slug', () => {
    expect(parseOwnItCheckParams({ product: 'macbook-air-13' })).toMatchObject({
      productSlug: 'macbook-air-13',
      name: null,
      error: null,
    });
  });

  it('parses typed name/brand/gtin, trimming whitespace', () => {
    expect(
      parseOwnItCheckParams({ name: '  MacBook Air 13 ', brand: ' Apple ', gtin: '0194253161783' })
    ).toMatchObject({
      productSlug: null,
      name: 'MacBook Air 13',
      brand: 'Apple',
      gtin: '0194253161783',
      error: null,
    });
  });

  it('takes the first value of a repeated param', () => {
    expect(parseOwnItCheckParams({ product: ['a', 'b'] }).productSlug).toBe('a');
  });

  it('rejects an over-long name instead of truncating it', () => {
    const parsed = parseOwnItCheckParams({ name: 'x'.repeat(201) });
    expect(parsed.error).toMatch(/200 characters or fewer/);
  });

  it('rejects a GTIN with no digits', () => {
    const parsed = parseOwnItCheckParams({ name: 'MacBook Air 13', gtin: '---' });
    expect(parsed.error).toMatch(/at least one digit/);
  });

  it('treats absent params as no query yet, not an error', () => {
    expect(parseOwnItCheckParams({})).toMatchObject({
      productSlug: null,
      name: null,
      error: null,
    });
  });
});
