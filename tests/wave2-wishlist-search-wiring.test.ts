/**
 * Wave-2 wiring tests (compare/search/wishlists, 2026-11-10).
 *
 * The pages themselves are client components (node env here, no DOM),
 * so these tests cover the pure logic the wiring depends on:
 *  - the search page's ItemList JSON-LD is built from the real
 *    displayed results only — real product slugs, in display order,
 *    nothing invented;
 *  - the wishlist/search Deal Score fetch leaves a card badge-less
 *    (null) when there is no prediction, instead of synthesizing one.
 */
import { describe, it, expect } from 'vitest';
import { buildItemListJsonLd, toJsonLd } from '@/lib/json-ld';
import { computeDealScoreFromPrediction } from '@/lib/deal-score';

const SITE = 'https://shahjahanaibuy-b1zp.vercel.app';

describe('search ItemList JSON-LD (app/search/page.tsx)', () => {
  it('lists only the real displayed results, in order, as product URLs', () => {
    const displayed = [
      { product: { name: 'MacBook Air 13', slug: 'macbook-air-13' } },
      { product: { name: 'Dell XPS 13', slug: 'dell-xps-13' } },
    ];
    const list = buildItemListJsonLd(
      SITE,
      displayed.map((r) => ({ name: r.product.name, path: `/products/${r.product.slug}` }))
    );
    expect(list['@type']).toBe('ItemList');
    const items = list.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      name: 'MacBook Air 13',
      url: `${SITE}/products/macbook-air-13`,
    });
    expect(items[1].position).toBe(2);
    expect(items[1].url).toBe(`${SITE}/products/dell-xps-13`);
  });

  it('emits an empty itemListElement (not a fake entry) when nothing is displayed', () => {
    const list = buildItemListJsonLd(SITE, []);
    expect((list.itemListElement as unknown[])).toHaveLength(0);
  });

  it('escapes markup in result names so the script tag cannot break out', () => {
    const json = toJsonLd(
      buildItemListJsonLd(SITE, [{ name: 'Test </script><script>', path: '/products/test' }])
    );
    expect(json).not.toContain('</script>');
    expect(json).toContain('\\u003c/script>');
  });
});

describe('wishlist/search Deal Score no-badge path', () => {
  it('returns null (no badge) when the prediction fetch has nothing', () => {
    expect(computeDealScoreFromPrediction(null)).toBeNull();
    expect(computeDealScoreFromPrediction(undefined)).toBeNull();
  });

  it('returns a real score when a prediction exists', () => {
    const score = computeDealScoreFromPrediction({
      discountProbability: 0.8,
      currentPrice: 900,
      lowestPrice: 800,
      confidenceScore: 0.9,
    });
    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThanOrEqual(0);
    expect(score as number).toBeLessThanOrEqual(100);
  });
});
