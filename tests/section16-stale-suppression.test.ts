/**
 * Section 16, item 12 — stale-offer suppression tests.
 *
 * POLICY (lib/product-seo.ts): a recorded price is treated as
 * valid until the day it would be called stale (data_freshness +
 * STALE_PRICE_DAYS = 7). Once the recorded price IS stale (> 7
 * days), buildProductJsonLd drops the offers block entirely, so no
 * crawler ever reads a stale price as a current offer. While
 * fresh, the offer carries priceValidUntil (recorded when present,
 * otherwise derived from data_freshness).
 *
 * These tests use REAL dates against a fixed `now` — this is the
 * branch the existing fixture deliberately does NOT cover
 * (tests/product-seo.test.ts uses dataFreshness: null on purpose).
 * That fixture is untouched; this file covers the real-date branch.
 */
import { describe, it, expect } from 'vitest';
import {
  buildProductJsonLd,
  deriveOfferPriceValidUntil,
  type ProductSeoData,
} from '@/lib/product-seo';

const SITE = 'https://shahjahanaibuy-b1zp.vercel.app';

/** Fixed "now" so the stale/fresh boundary cannot drift with the clock. */
const NOW = new Date('2026-11-12T12:00:00Z');

/** ISO timestamp N whole days before NOW. */
function daysBeforeNow(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

const FRESH = daysBeforeNow(3); // 2026-11-09 — 3 days old
const STALE = daysBeforeNow(10); // 2026-11-02 — 10 days old
const BOUNDARY = daysBeforeNow(7); // 2026-11-05 — exactly 7 days old

function seo(overrides: Partial<ProductSeoData> = {}): ProductSeoData {
  return {
    id: '3aa8470f-7bcd-448d-bd09-bd1ce13c31f6',
    name: 'MacBook Air 13',
    slug: 'macbook-air-13',
    description: 'Apple MacBook Air 13 with M-series chip.',
    brand: 'Apple',
    category: 'Laptops',
    imageUrl: 'https://example.com/macbook.jpg',
    gtin: null,
    confidenceScore: 95,
    lowestPrice: 999,
    priceValidUntil: null,
    inStock: true,
    averageRating: 0,
    reviewCount: 0,
    dataFreshness: FRESH,
    ...overrides,
  };
}

/** The Product node inside the @graph document buildProductJsonLd emits. */
function productNode(data: ProductSeoData, now: Date = NOW) {
  const doc = JSON.parse(buildProductJsonLd(data, SITE, now));
  expect(doc['@context']).toBe('https://schema.org');
  const product = doc['@graph'].find(
    (node: Record<string, unknown>) => node['@type'] === 'Product'
  );
  expect(product).toBeDefined();
  return product as Record<string, unknown>;
}

describe('deriveOfferPriceValidUntil — real dates', () => {
  it('fresh (3 days old) derives freshness + 7 days', () => {
    // Checked 2026-11-09, valid until the day it would go stale.
    expect(deriveOfferPriceValidUntil(FRESH, NOW)).toBe('2026-11-16');
  });

  it('stale (10 days old) returns null — the validity window has closed', () => {
    expect(deriveOfferPriceValidUntil(STALE, NOW)).toBeNull();
  });

  it('exactly 7 days old is still valid (stale only above 7)', () => {
    expect(deriveOfferPriceValidUntil(BOUNDARY, NOW)).toBe('2026-11-12');
  });

  it('null / unparseable freshness returns null (no date invented)', () => {
    expect(deriveOfferPriceValidUntil(null, NOW)).toBeNull();
    expect(deriveOfferPriceValidUntil(undefined, NOW)).toBeNull();
    expect(deriveOfferPriceValidUntil('not-a-date', NOW)).toBeNull();
  });
});

describe('buildProductJsonLd — fresh price keeps the offers block', () => {
  it('fresh freshness includes offers with the derived priceValidUntil', () => {
    const product = productNode(seo({ dataFreshness: FRESH }));
    expect(product.offers).toBeDefined();
    const offers = product.offers as Record<string, unknown>;
    expect(offers['@type']).toBe('Offer');
    expect(offers.price).toBe(999);
    expect(offers.priceValidUntil).toBe('2026-11-16');
  });

  it('a recorded priceValidUntil is used as-is while fresh', () => {
    const product = productNode(
      seo({ dataFreshness: FRESH, priceValidUntil: '2026-11-20' })
    );
    const offers = product.offers as Record<string, unknown>;
    expect(offers.priceValidUntil).toBe('2026-11-20');
  });
});

describe('buildProductJsonLd — stale price DROPS the offers block', () => {
  it('stale (10 days old) freshness removes offers entirely', () => {
    const product = productNode(seo({ dataFreshness: STALE }));
    expect('offers' in product).toBe(false);
    expect(product.offers).toBeUndefined();
    // The product itself (name, url) is still emitted — only the
    // offer is suppressed, the page is not emptied.
    expect(product.name).toBe('MacBook Air 13');
    expect(product.url).toBe(`${SITE}/products/macbook-air-13`);
  });

  it('stale freshness suppresses offers even when a priceValidUntil is recorded', () => {
    const product = productNode(
      seo({ dataFreshness: STALE, priceValidUntil: '2026-11-20' })
    );
    expect('offers' in product).toBe(false);
  });

  it('exactly 7 days old still keeps offers (boundary is not stale)', () => {
    const product = productNode(seo({ dataFreshness: BOUNDARY }));
    expect(product.offers).toBeDefined();
    const offers = product.offers as Record<string, unknown>;
    expect(offers.priceValidUntil).toBe('2026-11-12');
  });

  it('an unpriced product has no offers even while fresh (existing rule, unchanged)', () => {
    const product = productNode(seo({ dataFreshness: FRESH, lowestPrice: null }));
    expect('offers' in product).toBe(false);
  });
});
