import { describe, expect, it } from 'vitest';
import {
  PRICE_MATCH_DISCLAIMER,
  PRICE_MATCH_LAST_REVIEWED,
  PRICE_MATCH_POLICIES,
  PRICE_MATCH_STATUS_LABELS,
  filterPriceMatchRows,
  parsePriceMatchFilter,
  policyForStore,
  priceMatchRowsForStores,
} from '@/lib/price-match-policies';

describe('PRICE_MATCH_POLICIES (T3 — curated at build time)', () => {
  it('records 7 policies verified from the retailers\u2019 own pages', () => {
    expect(PRICE_MATCH_POLICIES).toHaveLength(7);
    const stores = PRICE_MATCH_POLICIES.map((p) => p.store);
    expect(stores).toEqual([
      'Best Buy',
      'Walmart',
      'Target',
      'Newegg',
      'Costco',
      'Amazon',
      'eBay',
    ]);
  });

  it('every entry has a summary, a claim path, a source URL and the review stamp', () => {
    for (const policy of PRICE_MATCH_POLICIES) {
      expect(policy.summary.length).toBeGreaterThan(40);
      expect(policy.howToClaim.length).toBeGreaterThan(20);
      expect(policy.sourceUrl.startsWith('https://')).toBe(true);
      expect(policy.lastReviewed).toBe(PRICE_MATCH_LAST_REVIEWED);
      expect(policy.lastReviewed).toBe('2026-11-14');
    }
  });

  it('Best Buy is the only store recorded as matching competitor prices', () => {
    const yes = PRICE_MATCH_POLICIES.filter((p) => p.status === 'yes');
    expect(yes.map((p) => p.store)).toEqual(['Best Buy']);
  });

  it('Amazon is recorded as NOT price-matching', () => {
    const amazon = PRICE_MATCH_POLICIES.find((p) => p.store === 'Amazon');
    expect(amazon?.status).toBe('no');
    expect(amazon?.summary).toMatch(/does not offer price matching/);
  });

  it('Walmart, Target, Newegg and Costco match only their own prices', () => {
    for (const store of ['Walmart', 'Target', 'Newegg', 'Costco']) {
      const policy = PRICE_MATCH_POLICIES.find((p) => p.store === store);
      expect(policy?.status).toBe('limited');
    }
  });

  it('eBay reads "Varies by seller" — a marketplace has no single policy', () => {
    const ebay = PRICE_MATCH_POLICIES.find((p) => p.store === 'eBay');
    expect(ebay?.status).toBe('varies');
    expect(ebay?.summary).toMatch(/marketplace/i);
  });

  it('no entry promises a match or quotes a matched price', () => {
    const joined = PRICE_MATCH_POLICIES.map(
      (p) => `${p.summary} ${p.howToClaim}`
    ).join(' ');
    expect(joined).not.toMatch(/guaranteed|we will match your price|you will save/i);
    expect(joined).not.toMatch(/\$\d/);
  });

  it('the disclaimer tells the shopper to verify at the retailer\u2019s site', () => {
    expect(PRICE_MATCH_DISCLAIMER).toMatch(
      /always verify at the retailer\u2019s site before purchase/
    );
  });

  it('every status has a display label', () => {
    for (const policy of PRICE_MATCH_POLICIES) {
      expect(PRICE_MATCH_STATUS_LABELS[policy.status]).toBeTruthy();
    }
  });
});

describe('policyForStore', () => {
  it('finds a policy case-insensitively and trims whitespace', () => {
    expect(policyForStore('best buy')?.store).toBe('Best Buy');
    expect(policyForStore('  AMAZON  ')?.status).toBe('no');
  });

  it('returns null for an unrecorded store — never a guess', () => {
    expect(policyForStore('Daraz')).toBeNull();
    expect(policyForStore('Argos')).toBeNull();
    expect(policyForStore(null)).toBeNull();
    expect(policyForStore('')).toBeNull();
  });
});

describe('priceMatchRowsForStores', () => {
  it('dedupes repeat names and keeps first-seen order', () => {
    const rows = priceMatchRowsForStores([
      'eBay',
      'Walmart',
      'eBay',
      'Daraz',
      'walmart',
    ]);
    expect(rows.map((r) => r.store)).toEqual(['eBay', 'Walmart', 'Daraz']);
  });

  it('attaches the policy where recorded and null where not recorded', () => {
    const rows = priceMatchRowsForStores(['Best Buy', 'Daraz', 'Amazon']);
    expect(rows[0].policy?.status).toBe('yes');
    expect(rows[1].policy).toBeNull();
    expect(rows[2].policy?.status).toBe('no');
  });
});

describe('parsePriceMatchFilter', () => {
  it('accepts every known filter value', () => {
    expect(parsePriceMatchFilter({ status: 'yes' })).toBe('yes');
    expect(parsePriceMatchFilter({ status: 'not-recorded' })).toBe('not-recorded');
  });

  it('unknown or missing values fall back to all', () => {
    expect(parsePriceMatchFilter({ status: 'bogus' })).toBe('all');
    expect(parsePriceMatchFilter({})).toBe('all');
    expect(parsePriceMatchFilter(undefined)).toBe('all');
    expect(parsePriceMatchFilter({ status: ['yes', 'no'] })).toBe('yes');
  });
});

describe('filterPriceMatchRows', () => {
  const rows = priceMatchRowsForStores([
    'Best Buy',
    'Amazon',
    'Walmart',
    'Daraz',
    'eBay',
  ]);

  it('all returns every row', () => {
    expect(filterPriceMatchRows(rows, 'all')).toHaveLength(5);
  });

  it('not-recorded returns only stores without a policy', () => {
    expect(filterPriceMatchRows(rows, 'not-recorded').map((r) => r.store)).toEqual([
      'Daraz',
    ]);
  });

  it('status filters match only that status', () => {
    expect(filterPriceMatchRows(rows, 'yes').map((r) => r.store)).toEqual([
      'Best Buy',
    ]);
    expect(filterPriceMatchRows(rows, 'no').map((r) => r.store)).toEqual(['Amazon']);
    expect(filterPriceMatchRows(rows, 'limited').map((r) => r.store)).toEqual([
      'Walmart',
    ]);
    expect(filterPriceMatchRows(rows, 'varies').map((r) => r.store)).toEqual([
      'eBay',
    ]);
  });
});
