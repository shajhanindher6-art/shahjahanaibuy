import { describe, expect, it } from 'vitest';
import {
  computeBundleTotals,
  suggestCombo,
  type BundleItemInput,
} from '@/lib/bundles';
import {
  translationSourceLabel,
  isTranslatableLanguage,
  getTranslationProviderConfig,
} from '@/lib/product-translations';
import { slotDateFor, isKnownCurationRegion, CURATION_GUIDELINES } from '@/lib/curators';

function item(overrides: Partial<BundleItemInput>): BundleItemInput {
  return {
    slug: 'item',
    name: 'Item',
    brand: null,
    category: 'Laptops',
    lowestPriceUsd: 100,
    compareAtPriceUsd: null,
    ...overrides,
  };
}

describe('computeBundleTotals', () => {
  it('sums real recorded prices with no savings when no compare-at exists', () => {
    const totals = computeBundleTotals([item({ slug: 'a', lowestPriceUsd: 999 }), item({ slug: 'b', lowestPriceUsd: 49 })]);
    expect(totals.totalUsd).toBe(1048);
    expect(totals.savingsUsd).toBe(0);
    expect(totals.compareAtTotalUsd).toBe(0);
    expect(totals.pricedCount).toBe(2);
    expect(totals.unpricedSlugs).toEqual([]);
  });

  it('derives savings ONLY from recorded compare-at prices', () => {
    const totals = computeBundleTotals([
      item({ slug: 'a', lowestPriceUsd: 999, compareAtPriceUsd: 1099 }),
      item({ slug: 'b', lowestPriceUsd: 49, compareAtPriceUsd: 49 }),
    ]);
    expect(totals.totalUsd).toBe(1048);
    expect(totals.compareAtTotalUsd).toBe(1148); // 1099 + 49 (both recorded compare-at prices)
    expect(totals.savingsUsd).toBe(100);
  });

  it('never counts a compare-at below the price as savings', () => {
    const totals = computeBundleTotals([
      item({ slug: 'a', lowestPriceUsd: 999, compareAtPriceUsd: 900 }),
    ]);
    expect(totals.savingsUsd).toBe(0);
    expect(totals.compareAtTotalUsd).toBe(900);
  });

  it('lists unpriced items and treats the total as a lower bound', () => {
    const totals = computeBundleTotals([
      item({ slug: 'a', lowestPriceUsd: 999 }),
      item({ slug: 'b', lowestPriceUsd: null }),
    ]);
    expect(totals.totalUsd).toBe(999);
    expect(totals.pricedCount).toBe(1);
    expect(totals.unpricedSlugs).toEqual(['b']);
  });
});

describe('suggestCombo', () => {
  const anchor = item({ slug: 'macbook', name: 'MacBook', lowestPriceUsd: 999 });

  it('picks Likely before Possible before Unknown, then lowest price', () => {
    const combo = suggestCombo(
      anchor,
      [
        item({ slug: 'u1', name: 'Unknown cheap', lowestPriceUsd: 10, grade: 'Unknown' }),
        item({ slug: 'p1', name: 'Possible', lowestPriceUsd: 200, grade: 'Possible' }),
        item({ slug: 'l1', name: 'Likely expensive', lowestPriceUsd: 300, grade: 'Likely' }),
        item({ slug: 'l2', name: 'Likely cheap', lowestPriceUsd: 50, grade: 'Likely' }),
      ],
      3
    );
    expect(combo).not.toBeNull();
    expect(combo!.items.map((i) => i.slug)).toEqual(['macbook', 'l2', 'l1', 'p1']);
    expect(combo!.totals.totalUsd).toBe(999 + 50 + 300 + 200);
  });

  it('never suggests unpriced candidates, the anchor, or Sample Laptop', () => {
    const combo = suggestCombo(
      anchor,
      [
        item({ slug: 'macbook', name: 'Anchor again', lowestPriceUsd: 1, grade: 'Likely' }),
        item({ slug: 'sample-laptop', name: 'Sample Laptop', lowestPriceUsd: 1, grade: 'Likely' }),
        item({ slug: 'noprice', name: 'No price', lowestPriceUsd: null, grade: 'Likely' }),
      ],
      3
    );
    expect(combo).toBeNull();
  });

  it('returns null when no priced candidate exists', () => {
    expect(suggestCombo(anchor, [], 3)).toBeNull();
  });
});

describe('translation source labels', () => {
  it('labels machine output as auto-translated, never perfect', () => {
    expect(translationSourceLabel('auto')).toBe('Auto-translated — may contain errors');
    expect(translationSourceLabel('professional')).toBe('Professionally translated');
    expect(translationSourceLabel('community-verified')).toContain('verified');
  });

  it('treats English as the source, not a translation target', () => {
    expect(isTranslatableLanguage('en')).toBe(false);
    expect(isTranslatableLanguage('ur')).toBe(true);
    expect(isTranslatableLanguage('xx')).toBe(false);
  });

  it('stays dormant without a configured provider endpoint + key', () => {
    const prevEndpoint = process.env.TRANSLATION_PROVIDER_ENDPOINT;
    const prevKey = process.env.TRANSLATION_PROVIDER_API_KEY;
    delete process.env.TRANSLATION_PROVIDER_ENDPOINT;
    delete process.env.TRANSLATION_PROVIDER_API_KEY;
    expect(getTranslationProviderConfig()).toBeNull();
    process.env.TRANSLATION_PROVIDER_ENDPOINT = 'https://example.invalid/translate';
    expect(getTranslationProviderConfig()).toBeNull();
    process.env.TRANSLATION_PROVIDER_API_KEY = 'test-key';
    expect(getTranslationProviderConfig()).toEqual({
      endpoint: 'https://example.invalid/translate',
      apiKey: 'test-key',
    });
    if (prevEndpoint === undefined) delete process.env.TRANSLATION_PROVIDER_ENDPOINT;
    else process.env.TRANSLATION_PROVIDER_ENDPOINT = prevEndpoint;
    if (prevKey === undefined) delete process.env.TRANSLATION_PROVIDER_API_KEY;
    else process.env.TRANSLATION_PROVIDER_API_KEY = prevKey;
  });
});

describe('curator helpers', () => {
  it('formats slot dates as UTC YYYY-MM-DD', () => {
    expect(slotDateFor(new Date('2026-11-10T05:00:00.000Z'))).toBe('2026-11-10');
  });

  it('recognises known regions and rejects unknown codes', () => {
    expect(isKnownCurationRegion('PK')).toBe(true);
    expect(isKnownCurationRegion('US')).toBe(true);
    expect(isKnownCurationRegion('XX')).toBe(false);
    expect(isKnownCurationRegion(null)).toBe(false);
  });

  it('publishes guidelines that forbid fake deals and vote-based verification', () => {
    const titles = CURATION_GUIDELINES.map((g) => g.title);
    expect(titles).toContain('Never a fake deal');
    expect(titles).toContain('Upvotes never verify');
    expect(CURATION_GUIDELINES.length).toBeGreaterThanOrEqual(5);
  });
});
