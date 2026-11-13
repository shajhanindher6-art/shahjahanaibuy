/**
 * Section 19, §12 #18 — buying considerations builder.
 *
 * Real signals in → considerations out; no signals → [] (the
 * component then renders the honest "not enough data" line).
 * Freshness math is pinned with an explicit `now`.
 */
import { describe, expect, it } from 'vitest';
import {
  buildBuyingConsiderations,
  type BuyingConsiderationInput,
} from '@/services/buying-considerations';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const FRESH = '2026-11-12T12:00:00.000Z'; // 1 day ago
const STALE = '2026-11-02T12:00:00.000Z'; // 11 days ago

function input(
  overrides: Partial<BuyingConsiderationInput> = {}
): BuyingConsiderationInput {
  return {
    lastCheckedAt: FRESH,
    merchants: [{ merchantName: 'Amazon', price: 999, compareAtPrice: 1299 }],
    totalReviews: 0,
    averageRating: null,
    verifiedReviews: 0,
    ...overrides,
  };
}

describe('no signals → no considerations', () => {
  it('returns [] when there is no merchant, no check date and no reviews', () => {
    expect(
      buildBuyingConsiderations(
        input({ lastCheckedAt: null, merchants: [] }),
        NOW
      )
    ).toEqual([]);
  });
});

describe('price freshness', () => {
  it('calls a 1-day-old check fresh', () => {
    const items = buildBuyingConsiderations(input(), NOW);
    expect(items[0].tone).toBe('ok');
    expect(items[0].text).toMatch(/last checked on Nov 12, 2026/);
    expect(items[0].text).toMatch(/within the last 7 days/);
  });

  it('warns on an 11-day-old check with the age in days', () => {
    const items = buildBuyingConsiderations(input({ lastCheckedAt: STALE }), NOW);
    expect(items[0].tone).toBe('caution');
    expect(items[0].text).toMatch(/11 days ago/);
    expect(items[0].text).toMatch(/may have moved/);
  });

  it('warns when merchants exist but no check date is recorded', () => {
    const items = buildBuyingConsiderations(input({ lastCheckedAt: null }), NOW);
    expect(items[0].tone).toBe('caution');
    expect(items[0].text).toMatch(/No price-check date is recorded/);
  });
});

describe('discount validation', () => {
  it('states a validated discount with the recorded compare-at price', () => {
    const items = buildBuyingConsiderations(input(), NOW);
    const discount = items.find((i) => i.text.includes('below its recorded compare-at'));
    expect(discount).toBeDefined();
    expect(discount?.tone).toBe('ok');
    expect(discount?.text).toMatch(/\$999 at Amazon/);
    expect(discount?.text).toMatch(/23\.1% below/);
    expect(discount?.text).toMatch(/\$1,299/);
  });

  it('says no discount can be verified when no compare-at is recorded', () => {
    const items = buildBuyingConsiderations(
      input({
        merchants: [{ merchantName: 'Amazon', price: 999, compareAtPrice: null }],
      }),
      NOW
    );
    expect(
      items.find((i) => i.text.includes('no discount percentage can be verified'))
    ).toBeDefined();
  });

  it('does not claim a discount when compare-at is at or below the price', () => {
    const items = buildBuyingConsiderations(
      input({
        merchants: [{ merchantName: 'Amazon', price: 999, compareAtPrice: 999 }],
      }),
      NOW
    );
    expect(items.some((i) => i.text.includes('below its recorded compare-at'))).toBe(false);
  });
});

describe('price position', () => {
  it('states the spread across retailers with the cheapest saving', () => {
    const items = buildBuyingConsiderations(
      input({
        merchants: [
          { merchantName: 'Amazon', price: 999, compareAtPrice: 1299 },
          { merchantName: 'Best Buy', price: 1099, compareAtPrice: null },
        ],
      }),
      NOW
    );
    const spread = items.find((i) => i.text.includes('retailers list this product'));
    expect(spread?.text).toMatch(/2 retailers list this product, from \$999 to \$1,099/);
    expect(spread?.text).toMatch(/\$100 lower than the most expensive/);
  });

  it('says so when only one retailer lists the product', () => {
    const items = buildBuyingConsiderations(input(), NOW);
    expect(
      items.find((i) => i.text.includes('Only one retailer lists this product'))
    ).toBeDefined();
  });

  it('says so when every retailer charges the same price', () => {
    const items = buildBuyingConsiderations(
      input({
        merchants: [
          { merchantName: 'Amazon', price: 999, compareAtPrice: null },
          { merchantName: 'Best Buy', price: 999, compareAtPrice: null },
        ],
      }),
      NOW
    );
    expect(
      items.find((i) => i.text.includes('at the same price ($999)'))
    ).toBeDefined();
  });
});

describe('trust signals', () => {
  it('states the recorded rating and verified purchases', () => {
    const items = buildBuyingConsiderations(
      input({ totalReviews: 12, averageRating: 4.5, verifiedReviews: 3 }),
      NOW
    );
    const trust = items.find((i) => i.text.includes('Rated 4.5 out of 5'));
    expect(trust).toBeDefined();
    expect(trust?.tone).toBe('ok');
    expect(trust?.text).toMatch(/from 12 reviews, including 3 verified purchases/);
  });

  it('emits no trust line when no reviews are recorded', () => {
    const items = buildBuyingConsiderations(input(), NOW);
    expect(items.some((i) => i.text.includes('Rated'))).toBe(false);
    expect(items.some((i) => i.text.includes('review'))).toBe(false);
  });
});
