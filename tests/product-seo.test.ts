import { describe, it, expect } from 'vitest';
import {
  buildProductDescription,
  buildProductJsonLd,
  buildProductMetadata,
  toInitialProduct,
  type ProductSeoData,
} from '@/lib/product-seo';

// P0 fix (2026-11-09 audit): all 11 products shared one generic
// title/description and the JSON-LD/h1 only existed after client JS.

const SITE = 'https://shahjahanaibuy-b1zp.vercel.app';

const macbook: ProductSeoData = {
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
  inStock: true,
  averageRating: 0,
  reviewCount: 0,
};

describe('buildProductMetadata', () => {
  it('uses the product name as title and a per-product canonical', () => {
    const meta = buildProductMetadata(macbook, SITE);
    // The root layout template appends " | SmartBuy AI".
    expect(meta.title).toBe('MacBook Air 13');
    expect(meta.alternates?.canonical).toBe(
      `${SITE}/products/macbook-air-13`
    );
    expect(meta.description).toBe('Apple MacBook Air 13 with M-series chip.');
    const og = meta.openGraph as { title?: string; url?: string };
    expect(og.title).toBe('MacBook Air 13 — SmartBuy AI');
    expect(og.url).toBe(`${SITE}/products/macbook-air-13`);
  });

  it('falls back to a generated description when none is recorded', () => {
    const meta = buildProductMetadata(
      { ...macbook, description: null },
      SITE
    );
    expect(meta.description).toContain('MacBook Air 13');
    expect(meta.description).toContain('Apple');
  });

  it('omits images when the product has no image URL', () => {
    const meta = buildProductMetadata({ ...macbook, imageUrl: null }, SITE);
    const og = meta.openGraph as { images?: unknown };
    expect(og.images).toBeUndefined();
  });
});

describe('buildProductDescription', () => {
  it('prefers the recorded description', () => {
    expect(buildProductDescription(macbook)).toBe(
      'Apple MacBook Air 13 with M-series chip.'
    );
  });
});

describe('buildProductJsonLd', () => {
  it('includes offers with the recorded lowest price and stock state', () => {
    const jsonLd = JSON.parse(buildProductJsonLd(macbook, SITE));
    expect(jsonLd['@type']).toBe('Product');
    expect(jsonLd.name).toBe('MacBook Air 13');
    expect(jsonLd.offers.price).toBe(999);
    expect(jsonLd.offers.priceCurrency).toBe('USD');
    expect(jsonLd.offers.availability).toBe('https://schema.org/InStock');
    expect(jsonLd.offers.url).toBe(`${SITE}/products/macbook-air-13`);
  });

  it('omits offers when there is no priced listing', () => {
    const jsonLd = JSON.parse(
      buildProductJsonLd({ ...macbook, lowestPrice: null, inStock: null }, SITE)
    );
    expect(jsonLd.offers).toBeUndefined();
  });

  it('never emits an aggregate rating with zero reviews', () => {
    const jsonLd = JSON.parse(buildProductJsonLd(macbook, SITE));
    expect(jsonLd.aggregateRating).toBeUndefined();
  });

  it('emits an aggregate rating only with real reviews', () => {
    const jsonLd = JSON.parse(
      buildProductJsonLd(
        { ...macbook, averageRating: 4.5, reviewCount: 12 },
        SITE
      )
    );
    expect(jsonLd.aggregateRating.ratingValue).toBe(4.5);
    expect(jsonLd.aggregateRating.reviewCount).toBe(12);
  });

  it('marks OutOfStock when listings exist but none is in stock', () => {
    const jsonLd = JSON.parse(
      buildProductJsonLd({ ...macbook, inStock: false }, SITE)
    );
    expect(jsonLd.offers.availability).toBe(
      'https://schema.org/OutOfStock'
    );
  });
});

describe('toInitialProduct', () => {
  it('maps only the fields the client component renders first', () => {
    const initial = toInitialProduct(macbook);
    expect(initial).toEqual({
      id: macbook.id,
      name: 'MacBook Air 13',
      slug: 'macbook-air-13',
      description: 'Apple MacBook Air 13 with M-series chip.',
      brand: 'Apple',
      category: 'Laptops',
      imageUrl: 'https://example.com/macbook.jpg',
      gtin: null,
      confidenceScore: 95,
    });
    expect('lowestPrice' in initial).toBe(false);
  });
});
